/**
 * Media Utilities - Audio streaming helpers for Gemini Live API
 * Handles media capture, processing, and playback
 */

/**
 * Audio Streamer - Captures and streams microphone audio
 */
class AudioStreamer {
  constructor(geminiClient) {
    this.client = geminiClient;
    this.audioContext = null;
    this.audioWorklet = null;
    this.mediaStream = null;
    this.audioSource = null;
    this.isStreaming = false;
    this.muted = false; // Keep the mic open but stop sending audio
    this.sampleRate = 16000; // Gemini requires 16kHz
    // Optional () => boolean. While it returns true, silence is sent instead of
    // the mic signal so speaker echo can't interrupt the model (half-duplex).
    this.isOutputPlaying = null;
  }

  /**
   * Pause or resume sending audio without releasing the microphone.
   * When muting, an audioStreamEnd is sent so the server flushes cached audio.
   */
  setMuted(muted) {
    if (this.muted === muted) return;
    this.muted = muted;
    if (muted && this.client && this.client.connected) {
      this.client.sendAudioStreamEnd();
    }
  }

  /**
   * Create the AudioContext. Call synchronously from a click handler:
   * iOS Safari only allows audio to start inside a user gesture.
   * The context runs at the device's native rate (iOS Safari can't record
   * into a 16kHz context) and audio is downsampled before sending.
   */
  prepare() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
  }

  /**
   * Start streaming audio from microphone
   * @param {string} deviceId - Optional device ID for specific microphone
   */
  async start(deviceId = null) {
    if (this.isStreaming) {
      return;
    }
    try {
      this.prepare();

      // Build audio constraints
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      // Add device ID if specified
      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
      }

      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      if (!this.audioWorklet) {
        // Load the audio worklet module
        await this.audioContext.audioWorklet.addModule(
          "audio-processors/capture.worklet.js"
        );

        // Create the audio worklet node
        this.audioWorklet = new AudioWorkletNode(
          this.audioContext,
          "audio-capture-processor"
        );

        // Safari only runs nodes that reach the destination; keep it silent
        const silence = this.audioContext.createGain();
        silence.gain.value = 0;
        this.audioWorklet.connect(silence);
        silence.connect(this.audioContext.destination);

        // Set up message handling from the worklet
        this.audioWorklet.port.onmessage = (event) => {
          if (!this.isStreaming || this.muted) return;

          if (event.data.type === "audio") {
            let inputData = this.downsample(event.data.data, this.audioContext.sampleRate);
            if (this.isOutputPlaying && this.isOutputPlaying()) {
              inputData = new Float32Array(inputData.length);
            }
            const pcmData = this.convertToPCM16(inputData);
            const base64Audio = this.arrayBufferToBase64(pcmData);

            // Send to Gemini
            if (this.client && this.client.connected) {
              this.client.sendAudioMessage(base64Audio);
            }
          }
        };
      }

      // Ensure the context is running (it might be suspended by the browser or by us in stop())
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // Connect the audio graph
      this.audioSource = this.audioContext.createMediaStreamSource(
        this.mediaStream
      );
      this.audioSource.connect(this.audioWorklet);

      this.isStreaming = true;
      console.log(`🎤 Audio streaming started (${this.audioContext.sampleRate}Hz → 16kHz)`);
      return true;
    } catch (error) {
      console.error("Failed to start audio streaming:", error);
      throw error;
    }
  }

  /**
   * Downsample to 16kHz by averaging each window of input samples
   */
  downsample(input, inputRate) {
    if (inputRate === this.sampleRate) return input;
    const ratio = inputRate / this.sampleRate;
    const output = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < output.length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      output[i] = sum / Math.max(1, end - start);
    }
    return output;
  }

  /**
   * Stop audio streaming
   */
  stop() {
    this.isStreaming = false;

    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }

    if (this.audioContext && this.audioContext.state === "running") {
      this.audioContext.suspend();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    console.log("🛑 Audio streaming stopped");
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Convert Float32Array to PCM16 Int16Array
   */
  convertToPCM16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = sample * 0x7fff;
    }
    return int16Array.buffer;
  }

  /**
   * Convert ArrayBuffer to base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

/**
 * Audio Player - Plays audio responses from Gemini
 */
class AudioPlayer {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.gainNode = null;
    this.isInitialized = false;
    this.initPromise = null;
    this.volume = 1.0;
    this.sampleRate = 24000; // Gemini outputs at 24kHz
    this.playbackEndsAt = 0; // performance.now() timestamp when queued audio runs out
  }

  /**
   * Whether queued model audio is still playing
   */
  isPlaying(tailMs = 0) {
    return performance.now() < this.playbackEndsAt + tailMs;
  }

  /**
   * Initialize the audio player
   */
  async init() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Create audio context at 24kHz to match Gemini
        this.audioContext = new (window.AudioContext ||
          window.webkitAudioContext)({
          sampleRate: this.sampleRate,
        });

        // Resume immediately since we are in a user-initiated gesture
        if (this.audioContext.state === "suspended") {
          await this.audioContext.resume();
        }

        // Load the audio worklet from external file
        await this.audioContext.audioWorklet.addModule(
          "audio-processors/playback.worklet.js"
        );

        // Create worklet node
        this.workletNode = new AudioWorkletNode(
          this.audioContext,
          "pcm-processor"
        );

        // Create gain node for volume control
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.volume;

        // Connect nodes
        this.workletNode.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);

        this.isInitialized = true;
        console.log("🔊 Audio player initialized");
      } catch (error) {
        console.error("Failed to initialize audio player:", error);
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * Play audio chunk from base64 PCM
   */
  async play(base64Audio) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      // Resume audio context if suspended
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // Efficient base64 → binary decode
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM16 LE to Float32
      const inputArray = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(inputArray.length);
      for (let i = 0; i < inputArray.length; i++) {
        float32Data[i] = inputArray[i] / 32768;
      }

      // Send to worklet for playback
      this.workletNode.port.postMessage(float32Data);

      const durationMs = (float32Data.length / this.sampleRate) * 1000;
      this.playbackEndsAt = Math.max(performance.now(), this.playbackEndsAt) + durationMs;
    } catch (error) {
      console.error("Error playing audio chunk:", error);
      throw error;
    }
  }

  /**
   * Interrupt current playback
   */
  interrupt() {
    if (this.workletNode) {
      this.workletNode.port.postMessage("interrupt");
    }
    this.playbackEndsAt = 0;
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.isInitialized = false;
    this.initPromise = null;
  }
}