export const INTERIM_V2_FLEET = [
  'bakeneko--bug-hunter',
  'daikoku--finance-steward',
  'fudo--security-guardian',
  'hanko--git-seal',
  'oni--red-team-reviewer',
  'tsuchigumo--research-weaver',
  'tsukumogami--code-forgemaster',
  'general',
  'explore',
  'scout'
];

export const AGENT_RENAME_MAP = [
  { current: 'tsukumo', next: 'tsukumogami--code-forgemaster', group: 'specialist' },
  { current: 'tsuchigumo', next: 'tsuchigumo--research-weaver', group: 'specialist' },
  { current: 'daikoku', next: 'daikoku--finance-steward', group: 'specialist' },
  { current: 'fudo', next: 'fudo--security-guardian', group: 'specialist' },
  { current: 'oni', next: 'oni--red-team-reviewer', group: 'subagent' },
  { current: 'bakeneko', next: 'bakeneko--bug-hunter', group: 'subagent' },
  { current: 'hanko', next: 'hanko--git-seal', group: 'subagent' },
  { current: 'tanuki', next: 'general', group: 'other' },
  { current: 'mikoshi', next: 'explore', group: 'other' },
  { current: 'karasutengu', next: 'scout', group: 'other' },
];

export const LEGACY_AGENT_ALIASES = {
  'code-runner': 'general',
  'explorer': 'explore',
  'source-retriever': 'general',
  'fact-checker': 'general',
  'data-analyst': 'general',
  debugger: 'bakeneko--bug-hunter',
  'technical-writer': 'general',
  synthesizer: 'general',
  reviewer: 'oni--red-team-reviewer',
  'prose-wordsmith': 'general',
  extractor: 'general',
  formatter: 'general',
  designer: 'general',
};

export const ALL_AGENT_TARGETS = [...INTERIM_V2_FLEET, 'kagami--verifier'];
export const RENAME_BY_CURRENT = new Map(AGENT_RENAME_MAP.map((entry) => [entry.current, entry.next]));
export const GROUPS = {
  specialists: INTERIM_V2_FLEET.filter(name => ['tsukumogami--code-forgemaster', 'tsuchigumo--research-weaver', 'daikoku--finance-steward', 'fudo--security-guardian'].includes(name)),
  subagents: INTERIM_V2_FLEET.filter(name => ['oni--red-team-reviewer', 'bakeneko--bug-hunter', 'hanko--git-seal'].includes(name)),
  others: INTERIM_V2_FLEET.filter(name => ['general', 'explore', 'scout'].includes(name)),
};

