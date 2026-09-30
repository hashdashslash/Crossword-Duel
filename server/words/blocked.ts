/**
 * Words the daily grid filler must never use: slurs, vulgarities and other
 * answers that would sour a breakfast-table puzzle. BLOCKED_FILL entries are
 * matched anywhere inside an answer; BLOCKED_EXACT only as the whole answer.
 */
export const BLOCKED_FILL = [
  'FUCK', 'SHIT', 'CUNT', 'NIGG', 'FAGGOT', 'WHORE', 'SLUT', 'BITCH', 'PISS', 'COCKSUCK', 'MOTHERF', 'BASTARD',
  'DICKHEAD', 'ASSHOLE', 'JIZZ', 'WANKER', 'TWAT', 'KIKE', 'SPIC', 'CHINK', 'WETBACK', 'RETARD', 'TRANNY',
  'DYKE', 'HOMO', 'NAZI', 'HITLER', 'RAPE', 'RAPING', 'RAPIST', 'PORN', 'DILDO', 'ORGASM', 'MASTURB', 'CLITOR',
  'PENIS', 'VAGIN', 'SCROT', 'TESTICL', 'NIPPLE', 'SEMEN', 'SPERM', 'ANUS', 'ANAL', 'RECTUM', 'FECES', 'FAECE',
  'TURD', 'CRAP', 'SUICID', 'GENOCID', 'HOLOCAUST', 'LYNCH', 'PEDO', 'PAEDO', 'MOLEST', 'INCEST', 'BESTIAL',
  'SODOM', 'HOOKER', 'PROSTITUT', 'COON', 'GOOK', 'WOP', 'DAGO', 'HONKY', 'HONKIE', 'GYPPED', 'GYPSY', 'SQUAW',
  'REDSKIN', 'HALFBREED', 'CRIPPLE', 'MIDGET', 'SPAZ', 'BOLLOCK', 'BUGGER', 'WANK', 'ERECTION', 'CONDOM',
  'AMENORRH', 'MENSTRU', 'BREAST', 'BOOB', 'TITS', 'SEXUAL', 'SEXY', 'SLAVE', 'NUDE', 'NAKED', 'STRIPPER', 'VOMIT', 'PUKE', 'URIN', 'DIARRH',
];

export const BLOCKED_EXACT = [
  'ASS', 'ASSES', 'ARSE', 'DICK', 'DICKS', 'COCK', 'COCKS', 'TIT', 'FAG', 'FAGS', 'HOE', 'HOES', 'JAP', 'JAPS',
  'PAKI', 'SPICK', 'HEB', 'KILL', 'KILLS', 'MURDER', 'SEX', 'SEXES', 'POO', 'POOP', 'PEE', 'PEED', 'FART',
  'FARTS', 'DAMN', 'HELL', 'BUTT', 'BUTTS', 'PUSSY', 'SCREW', 'HUMP', 'KKK', 'BRALESS', 'HUSSY', 'FLOOZY', 'FLOOZIE', 'SKANK', 'SKANKY', 'HORNY', 'ORGY', 'ORGIES', 'BOOTY', 'NOONER', 'NOONERS', 'KAFFIR', 'KAFFIRS', 'GYP', 'GYPS', 'GAY', 'GAYS', 'QUEER', 'NUT', 'NUTS',
];

export function isBlocked(word: string): boolean {
  return BLOCKED_EXACT.includes(word) || BLOCKED_FILL.some((b) => word.includes(b));
}

/**
 * Crosswordese: words seen almost nowhere outside crossword grids (the
 * playbook's ERE, ASEA, ETERNE…). Solvers groan at them, so the daily
 * filler never uses them.
 */
export const CROSSWORDESE = [
  'ERE', 'ASEA', 'ETERNE', 'ALEE', 'ALA', 'OBI', 'OLEO', 'ALAR', 'ERNE', 'ONER', 'ONERS', 'AMAH', 'ERST', 'ENATE',
  'AGNATE', 'SERE', 'ANIL', 'RETE', 'ETUI', 'ENOL', 'ANAS', 'ANOA', 'ENDER', 'ARIL', 'OTIC', 'AGEE', 'ADIT',
  'OGEE', 'UNAU', 'ELD', 'EYRE', 'SEPT', 'ESNE', 'SNEE', 'ESTOP', 'ORT', 'ORTS', 'ILEA', 'ALAE', 'ELHI', 'NENE',
  'ORLE', 'AAL', 'ALB', 'EDH', 'OBE', 'TRET', 'ANES', 'NAE', 'OER', 'EEN', 'EER', 'NEER', 'TSE', 'ARTE', 'ETAT',
  'ESSE', 'ERAT', 'ORA', 'OSE', 'OLIO', 'EDDA', 'ESS', 'ENS', 'EMS', 'ETH', 'STOA', 'ILIA', 'ULNAE', 'OONA',
  'ATRA', 'ESTE', 'ALII', 'SSR', 'TAE', 'ANE', 'ACCA', 'ANOAS', 'ETUIS', 'ERNES', 'ADITS', 'ARILS', 'AMAHS',
  'OGEES', 'ENOLS', 'RETIA', 'SERER', 'SEREST', 'ALEF', 'ABAFT', 'ORRA', 'OTTO', 'EFT', 'EFTS', 'ESTRO', 'AGUE',
  'TOR', 'TORS', 'NAIF', 'NARD', 'RIA', 'RIAS', 'ELI', 'ENO', 'ONO', 'SETA', 'URAL', 'ENID', 'IRMA', 'OBIE',
];

export function isCrosswordese(word: string): boolean {
  return CROSSWORDESE.includes(word);
}
