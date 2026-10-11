// Random name generation for create_random_mailbox: first.last@domain. A
// small built-in name list replaces the Go namegenerator dependency.

const FIRST_NAMES = [
  "alice", "ben", "clara", "david", "emma", "felix", "greta", "hugo",
  "iris", "jack", "katja", "liam", "mila", "noah", "olive", "paul",
  "quinn", "rosa", "sam", "tessa", "ugo", "vera", "will", "yara",
];

const LAST_NAMES = [
  "adler", "berg", "clark", "dahl", "eriksen", "falk", "gomez", "hart",
  "ibarra", "jansen", "klein", "lind", "meyer", "novak", "olsson", "price",
  "quill", "reyes", "stein", "toll", "ulrich", "vogel", "wahl", "zimmer",
];

function randomOf(names: string[]): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return names[bytes[0]! % names.length]!;
}

/** randomAddress returns a generated address like john.smith@example.com,
 * lowercased per the first.last@domain address format. */
export function randomAddress(domain: string): string {
  return `${randomOf(FIRST_NAMES)}.${randomOf(LAST_NAMES)}@${domain}`;
}