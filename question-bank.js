/**
 * IELTS Speaking question bank: September–December 2026.
 * Compiled from candidate reports (ieltsactualtests, readingielts) — see
 * "雅思口說題庫 2026 年 9–12 月". Sample questions are paraphrased.
 * `isNew` marks topics that first appeared this season; they are drawn more often.
 * Replace this file when the season changes (January / May / September).
 */

const QUESTION_BANK_LABEL = "2026 年 9–12 月";

// The examiner opens Part 1 with exactly one of these
const PART1_OPENERS = [
  { topic: "Work or studies", samples: ["What do you do / study?", "Why did you choose it?", "What are your plans for the next five years?", "What technology do you use for your work or studies?"] },
  { topic: "Home and accommodation", samples: ["Do you live in a flat or a house?", "Who do you live with?", "Which room do you like most?", "Will you keep living there?"] },
  { topic: "Hometown", samples: ["Where is your hometown? Is it a big city?", "What is it famous for?", "Is it a good place for young people?"] },
  { topic: "The area you live in", samples: ["Is your area noisy or quiet?", "Are your neighbours friendly?", "Has it changed recently?", "Is it suitable for people of all ages?"] },
];

const PART1_TOPICS = [
  { topic: "Morning routine", samples: ["What's the first thing you do after you get up?", "Is breakfast important to you?"] },
  { topic: "Evening time", samples: ["What do you usually do in the evening?", "Is it different from when you were a child?"] },
  { topic: "Tiredness", isNew: true, samples: ["What makes you feel tired?", "What do you do when you're tired?"] },
  { topic: "Feeling bored", isNew: true, samples: ["When do you feel bored?", "Were you more bored as a child or now?"] },
  { topic: "Being tidy", samples: ["Did you have to tidy your room as a child?", "How do you keep your desk tidy?"] },
  { topic: "Politeness", isNew: true, samples: ["How did you learn to be polite as a child?", "Is politeness important?"] },
  { topic: "Remembering names", isNew: true, samples: ["Are you good at remembering people's names?", "How do you feel when someone forgets your name?"] },
  { topic: "Opportunities to try new things", isNew: true, samples: ["Did you have many chances to try new activities as a child?", "Should people try as many new things as possible?"] },
  { topic: "Dreams and ambition", samples: ["What did you dream of being as a child?", "Are you an ambitious person?"] },
  { topic: "Secondary school", isNew: true, samples: ["What was your favourite subject at secondary school?", "Which subject was the hardest?", "What do you miss about it?"] },
  { topic: "Teachers", samples: ["Did you have a favourite teacher?", "Do you still keep in touch with your old teachers?"] },
  { topic: "Science", samples: ["Did you study much science at school?", "Which area of science do you find interesting?"] },
  { topic: "History", samples: ["Do you like history?", "Have you ever been to a history museum?"] },
  { topic: "Outer space and stars", samples: ["Did you learn about space at school?", "Would you like to go into space?", "Do you like science-fiction films?"] },
  { topic: "Computers and tablets", isNew: true, samples: ["When did you first use a computer?", "What would your life be like without one?"] },
  { topic: "Websites", samples: ["Which websites do you visit in your free time?", "What kinds of websites are popular in your country?"] },
  { topic: "Social media", isNew: true, samples: ["Has anyone recommended a social media app to you?", "Do you spend too much time on social media?"] },
  { topic: "Headphones", samples: ["How often do you wear headphones?", "When wouldn't you use them?"] },
  { topic: "Shopping", samples: ["How often do you go shopping?", "Do you prefer shopping online or in shops?"] },
  { topic: "Street markets", isNew: true, samples: ["Do you often go to street markets?", "How are they different from supermarkets?"] },
  { topic: "Advertisements", isNew: true, samples: ["Have you ever bought something because of an advert?", "Do you remember any adverts from your childhood?"] },
  { topic: "Shoes", isNew: true, samples: ["Do you prefer fashionable or comfortable shoes?", "Have you ever bought shoes online?"] },
  { topic: "Clothes", samples: ["What do you usually like to wear?", "Do you prefer casual or formal clothes?"] },
  { topic: "Wearing a watch", samples: ["Do you often wear a watch?", "Why do some people wear expensive watches?"] },
  { topic: "Mirrors", samples: ["Do you often look in the mirror?", "Would you use mirrors to decorate a room?"] },
  { topic: "Collecting things", isNew: true, samples: ["Do you collect anything?", "Do you keep things from your childhood?"] },
  { topic: "Lost and found", isNew: true, samples: ["What would you do if you found something someone had lost?", "Have you ever lost your keys?"] },
  { topic: "Paper and letters", isNew: true, samples: ["Did you make things out of paper as a child?", "Do you still send handwritten letters?", "Should we use less paper?"] },
  { topic: "Fruit and vegetables", isNew: true, samples: ["Was there any fruit or vegetable you disliked as a child?", "Where do you buy them?"] },
  { topic: "Rubbish and recycling", isNew: true, samples: ["Do you sort your rubbish for recycling?", "What do you do if you see litter in the street?"] },
  { topic: "Parks and gardens", samples: ["Did you often go to parks as a child?", "Would you like more parks in your city?"] },
  { topic: "Old buildings", samples: ["Should old buildings be preserved?", "Would you rather live in an old or a new house?"] },
  { topic: "Travelling", isNew: true, samples: ["Do you like sitting by the window when you travel?", "Did you go on long trips with your family as a child?"] },
  { topic: "Cars", samples: ["Do you prefer driving or being a passenger?", "What do you do when you're stuck in traffic?"] },
  { topic: "Music", samples: ["Did you like listening to music as a child?", "Do you listen to music while doing other things?"] },
  { topic: "Singing", samples: ["Do you like singing?", "Have you ever had singing lessons?"] },
  { topic: "Films and cinemas", samples: ["Do you prefer watching films at home or at the cinema?", "Did you watch many films as a child?"] },
  { topic: "Art", samples: ["Do you like going to art galleries?", "Do you prefer modern or traditional art?"] },
  { topic: "Jokes and comedy", samples: ["Are you good at telling jokes?", "Do you like watching comedies?"] },
  { topic: "Sports programmes", samples: ["Do you like watching sport on TV?", "Have you ever been to a stadium to watch a match?"] },
  { topic: "Friends", samples: ["Where do you meet your friends now compared with the past?", "Do you prefer meeting one friend or a group?"] },
];

// Part 3 discussion directions, shared by related cue cards
const PART3_DIRECTIONS = {
  friendship: "Where children make friends; why people have fewer friends as they get older; how important friendship is for health and wellbeing; whether friendship should come before other relationships.",
  crowds: "The most crowded places in the candidate's country; pros and cons of densely populated areas; whether cities need quiet spaces; whether cities could become too crowded to live in; how technology lets people live in remote areas.",
  media: "Popular kinds of films in the candidate's country; how streaming has changed watching habits; whether children's reading habits have changed.",
  fame: "Whether celebrities should be role models; whether the media can be trusted; why people care about local news.",
  learning: "What young people can learn from older people; how adults should teach children; the best way to learn a language.",
  health: "How governments can encourage exercise; why medical jobs attract or put off people.",
  publicPlaces: "Who should pay for public facilities; the effect of tall buildings on cities; why city dwellers need contact with nature.",
  money: "What makes good service; whether young people should learn to manage money early; how spending habits are changing.",
  decisions: "How people make big decisions; whether young people change their minds more easily than older people.",
  teamwork: "Advantages and disadvantages of teamwork; how to make talks more engaging.",
  technology: "Whether people rely too much on technology; whether instant messaging makes people less patient.",
  environment: "Whether individuals or governments are responsible for the environment; whether laws or education work better.",
};

const PART2_CARDS = [
  // People
  { card: "a childhood friend you remember well", part3: "friendship" },
  { card: "a happy person you know", isNew: true, part3: "friendship" },
  { card: "a person who improved his or her fitness", isNew: true, part3: "health" },
  { card: "a person much older than you that you admire", isNew: true, part3: "learning" },
  { card: "a person who taught you a new skill when you were a child", isNew: true, part3: "learning" },
  { card: "a person who did something difficult and succeeded" },
  { card: "a person who has a successful business" },
  { card: "a person who is good at learning languages", part3: "learning" },
  { card: "a person who is good at making things", isNew: true },
  { card: "a person who is popular with others", isNew: true, part3: "friendship" },
  { card: "a person who likes growing plants" },
  { card: "a person who likes learning about history", isNew: true },
  { card: "a person who really likes taking photos", isNew: true },
  { card: "a well-organised person you know", isNew: true },
  { card: "a sportsperson who did well at a sporting event", isNew: true, part3: "health" },
  { card: "someone who always wanted to work in medicine", part3: "health" },
  { card: "an interview with a famous person that you watched", isNew: true, part3: "fame" },
  // Places
  { card: "a crowded place you have been to", isNew: true, part3: "crowds" },
  { card: "a noisy place you have been to", isNew: true, part3: "crowds" },
  { card: "a public building you enjoy being in, such as a library or sports centre", isNew: true, part3: "publicPlaces" },
  { card: "an outdoor place where you enjoy nature", isNew: true, part3: "publicPlaces" },
  { card: "a place you went to on holiday that you would recommend" },
  { card: "a place where you remember feeling bored" },
  { card: "a person's home that you liked but would not want to live in" },
  { card: "a tall building you like or dislike", part3: "publicPlaces" },
  // Events and experiences
  { card: "a party you went to that celebrated a special event", isNew: true },
  { card: "an enjoyable evening you spent with friends", isNew: true, part3: "friendship" },
  { card: "a time you helped someone with a problem", isNew: true },
  { card: "a time you received good service in a shop", isNew: true, part3: "money" },
  { card: "a time you saved money to buy something", isNew: true, part3: "money" },
  { card: "a time you listened to a talk you were not interested in", isNew: true, part3: "teamwork" },
  { card: "a short journey you often make but dislike", isNew: true },
  { card: "an activity you do routinely but think is a waste of time", isNew: true },
  { card: "a time you changed your opinion about something important", part3: "decisions" },
  { card: "a time you had to change a plan", part3: "decisions" },
  { card: "a time you had to get up very early" },
  { card: "a time you watched a live sports event" },
  { card: "a time you worked in a group", part3: "teamwork" },
  { card: "a time you waited a long time for a reply", part3: "technology" },
  { card: "an important decision you made that you were pleased with", part3: "decisions" },
  { card: "an ambition you have had for a long time" },
  // Objects, media and issues
  { card: "a film you did not like", isNew: true, part3: "media" },
  { card: "an exciting book you enjoyed reading", isNew: true, part3: "media" },
  { card: "a story you like that has animals in it" },
  { card: "an interesting video you watched online", part3: "media" },
  { card: "an advertisement that featured a famous person", part3: "fame" },
  { card: "some local news that people were interested in", part3: "fame" },
  { card: "a problem you had with technology", part3: "technology" },
  { card: "a type of food you eat on special occasions" },
  { card: "a law your country should have to help the environment", part3: "environment" },
];
