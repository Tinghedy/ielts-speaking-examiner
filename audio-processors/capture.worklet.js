/**
 * Audio Worklet Processor for capturing and processing audio
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 32ms chunks at the context's sample rate — per Gemini best practices (20-40ms chunks).
    // Use a multiple of 3 so 48kHz downsamples to 16kHz without remainder.
    this.bufferSize = Math.round((sampleRate * 0.032) / 3) * 3;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const inputChannel = input[0];

      // Buffer the incoming audio
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex++] = inputChannel[i];

        // When buffer is full, send it to main thread
        if (this.bufferIndex >= this.bufferSize) {
          // Send the buffered audio to the main thread
          this.port.postMessage({
            type: "audio",
            data: this.buffer.slice(),
          });

          // Reset buffer
          this.bufferIndex = 0;
        }
      }
    }

    // Return true to keep the processor alive
    return true;
  }
}

// Register the processor
registerProcessor("audio-capture-processor", AudioCaptureProcessor);
