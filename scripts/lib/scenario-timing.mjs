function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function scenarioDurationMs(scenario, config = {}, behaviors = {}) {
  if (scenario === 'dad-shout' || scenario === 'grandpa-shout') return 20000;
  if (scenario !== 'poop-chase'
    || config.selection?.chaseVariant !== 'self-poop'
    || !config.selection?.userCharacterId) return 6000;

  const followerCount = Math.max(0, (config.characters || [])
    .filter((character) => character?.id !== config.selection.userCharacterId).length);
  const settings = behaviors.poopChase || {};
  const initialDelay = nonNegative(settings.initialDropDelayMs, 250);
  const roundDuration = nonNegative(settings.dropVisibleBeforeEatMs, 650)
    + nonNegative(settings.eatDurationMs, 420)
    + nonNegative(settings.consumedDelayMs, 240)
    + nonNegative(settings.roundResetDelayMs, 600);
  const required = initialDelay + followerCount * roundDuration + 4000;
  return Math.max(6000, Math.ceil(required / 1000) * 1000);
}
