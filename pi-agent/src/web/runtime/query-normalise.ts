const contractions: Record<string, string> = {
  "don't": "do not",
  "can't": "cannot",
  "won't": "will not",
  "it's": "it is",
  "i'm": "i am",
  "i've": "i have",
  "i'll": "i will",
  "i'd": "i would",
  "you're": "you are",
  "you've": "you have",
  "you'll": "you will",
  "you'd": "you would",
  "he's": "he is",
  "she's": "she is",
  "we're": "we are",
  "we've": "we have",
  "we'll": "we will",
  "we'd": "we would",
  "they're": "they are",
  "they've": "they have",
  "they'll": "they will",
  "they'd": "they would",
  "that's": "that is",
  "what's": "what is",
  "who's": "who is",
  "there's": "there is",
  "here's": "here is",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "weren't": "were not",
  "hasn't": "has not",
  "haven't": "have not",
  "doesn't": "does not",
  "didn't": "did not",
  "wouldn't": "would not",
  "shouldn't": "should not",
  "couldn't": "could not",
  "mightn't": "might not",
  "mustn't": "must not",
};

export function normaliseQuery(text: string): string {
  if (!text) return "";

  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(
      /\b(?:don't|can't|won't|it's|i'm|i've|i'll|i'd|you're|you've|you'll|you'd|he's|she's|we're|we've|we'll|we'd|they're|they've|they'll|they'd|that's|what's|who's|there's|here's|isn't|aren't|wasn't|weren't|hasn't|haven't|doesn't|didn't|wouldn't|shouldn't|couldn't|mightn't|mustn't)\b/g,
      (m) => contractions[m] ?? m,
    )
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
