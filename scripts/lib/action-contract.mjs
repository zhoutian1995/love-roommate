export const COMMON_ACTIONS = Object.freeze([
  'crawl_right_1', 'crawl_right_2', 'crawl_left_1', 'crawl_left_2',
  'idle_right', 'idle_left', 'drag'
]);

export const GROUP_SHOUT_ACTIONS = Object.freeze([
  'kneel_shout_1', 'kneel_shout_2', 'kneel_shout_3'
]);

export const SELF_POOP_ACTIONS = Object.freeze(['poop_right', 'poop_left']);
export const FOLLOWER_EAT_ACTIONS = Object.freeze(['eat_right', 'eat_left']);
export const CURSOR_CENTIPEDE_ACTIONS = Object.freeze(['centipede_right', 'centipede_left']);

const SPECIAL_ACTIONS = new Set([
  ...GROUP_SHOUT_ACTIONS,
  ...SELF_POOP_ACTIONS,
  ...FOLLOWER_EAT_ACTIONS,
  ...CURSOR_CENTIPEDE_ACTIONS
]);
const ALL_ACTIONS = [
  ...COMMON_ACTIONS,
  ...GROUP_SHOUT_ACTIONS,
  ...SELF_POOP_ACTIONS,
  ...FOLLOWER_EAT_ACTIONS,
  ...CURSOR_CENTIPEDE_ACTIONS
];

export function actionFrameDescriptor(action, characterId) {
  if (/^crawl_(right|left)_[12]$/.test(action)) {
    return {
      group: action.replace(/_[12]$/, ''),
      index: Number(action.at(-1)) - 1,
      relative: `${characterId}/${action}.png`
    };
  }
  if (/^kneel_shout_[123]$/.test(action)) {
    const runtimeAction = action.replace('kneel_shout_', 'shout_');
    return {
      group: 'shout',
      index: Number(action.at(-1)) - 1,
      relative: `${characterId}/${runtimeAction}.png`
    };
  }
  return { group: action, index: 0, relative: `${characterId}/${action}.png` };
}

export function manifestHasAction(entry, action) {
  const descriptor = actionFrameDescriptor(action, entry.id);
  return entry.frames?.[descriptor.group]?.[descriptor.index] === descriptor.relative;
}

export function deriveActionContract(config = {}) {
  const characterIds = Array.isArray(config.characters)
    ? config.characters.map((character) => character.id)
    : [];
  const selection = config.selection || {};
  const groupShoutEnabled = ['group-shout', 'all'].includes(selection.mode)
    && (selection.groupShoutSkippedReason ?? null) === null;
  const chaseEnabled = ['poop-chase', 'all'].includes(selection.mode)
    && (selection.chaseSkippedReason ?? null) === null;
  const chaseVariant = chaseEnabled
    ? (selection.userCharacterId ? 'self-poop' : 'cursor-centipede')
    : null;
  const actionsByCharacter = {};
  const rolesByCharacter = {};

  for (const characterId of characterIds) {
    const actions = [...COMMON_ACTIONS];
    const groupShoutParticipant = groupShoutEnabled && characterId !== selection.userCharacterId;
    if (groupShoutParticipant) actions.push(...GROUP_SHOUT_ACTIONS);

    let chaseRole = null;
    if (chaseVariant === 'self-poop') {
      chaseRole = characterId === selection.userCharacterId ? 'poop' : 'eat';
      actions.push(...(chaseRole === 'poop' ? SELF_POOP_ACTIONS : FOLLOWER_EAT_ACTIONS));
    } else if (chaseVariant === 'cursor-centipede') {
      chaseRole = 'centipede';
      actions.push(...CURSOR_CENTIPEDE_ACTIONS);
    }

    actionsByCharacter[characterId] = actions;
    rolesByCharacter[characterId] = { groupShoutParticipant, chaseRole };
  }

  return {
    characterIds,
    mode: selection.mode ?? null,
    userCharacterId: selection.userCharacterId ?? null,
    groupShoutEnabled,
    chaseVariant,
    actionsByCharacter,
    rolesByCharacter
  };
}

export function manifestActionInventory(manifest = {}) {
  const actionsByCharacter = {};
  for (const entry of manifest.characters || []) {
    actionsByCharacter[entry.id] = ALL_ACTIONS.filter((action) => manifestHasAction(entry, action));
  }
  return actionsByCharacter;
}

export function compareActionContract(contract, manifest = {}) {
  const manifestCharacters = Array.isArray(manifest.characters) ? manifest.characters : [];
  const manifestIds = manifestCharacters.map((entry) => entry.id);
  const expectedIds = contract.characterIds || [];
  const duplicateCharacterIds = manifestIds.filter((id, index) => manifestIds.indexOf(id) !== index)
    .filter((id, index, values) => values.indexOf(id) === index);
  const missingCharacterIds = expectedIds.filter((id) => !manifestIds.includes(id));
  const unexpectedCharacterIds = manifestIds.filter((id) => !expectedIds.includes(id));
  const actualActionsByCharacter = manifestActionInventory(manifest);
  const missingActions = [];
  const unexpectedActions = [];

  for (const characterId of expectedIds) {
    const expected = contract.actionsByCharacter?.[characterId] || [];
    const actual = actualActionsByCharacter[characterId] || [];
    for (const action of expected) {
      if (!actual.includes(action)) missingActions.push({ characterId, action });
    }
    for (const action of actual) {
      if (!expected.includes(action) && SPECIAL_ACTIONS.has(action)) {
        unexpectedActions.push({ characterId, action });
      }
    }
  }

  const misassignedActions = [];
  for (const missing of missingActions) {
    if (!SPECIAL_ACTIONS.has(missing.action)) continue;
    const expectedOwners = expectedIds.filter((id) => contract.actionsByCharacter?.[id]?.includes(missing.action));
    const actualCharacterIds = manifestIds.filter((id) => (
      !expectedOwners.includes(id) && actualActionsByCharacter[id]?.includes(missing.action)
    ));
    if (actualCharacterIds.length) {
      misassignedActions.push({
        action: missing.action,
        expectedCharacterId: missing.characterId,
        actualCharacterIds
      });
    }
  }

  return {
    missingCharacterIds,
    unexpectedCharacterIds,
    duplicateCharacterIds,
    missingActions,
    unexpectedActions,
    misassignedActions,
    actualActionsByCharacter,
    hasDrift: Boolean(
      missingCharacterIds.length
      || unexpectedCharacterIds.length
      || duplicateCharacterIds.length
      || missingActions.length
      || unexpectedActions.length
    )
  };
}
