// The settings' glob lists (scratch, ignore, shipIgnore): globs separated by commas, * and ? as wildcards,
// the rest literal, ignoring case.

// One glob, matched against a whole name.
export const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')

// The setting's globs, trimmed; unset (not a string) means the fallback.
export const globWords = (setting: unknown, fallback = '') =>
  (typeof setting === 'string' ? setting : fallback).split(',').map(glob => glob.trim()).filter(Boolean)

export const globList = (setting: unknown, fallback = '') => globWords(setting, fallback).map(globToRegExp)
