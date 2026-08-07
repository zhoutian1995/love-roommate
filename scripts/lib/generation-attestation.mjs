export const DEFAULT_GENERATION_ATTESTATION = Object.freeze({
  generator: 'codex-imagegen',
  declaredModelPolicy: 'gpt-image-2',
  evidenceLevel: 'workflow-attested'
});

export const NATIVE_TRANSPARENCY_ATTESTATION = Object.freeze({
  generationMode: 'native-transparent-fallback',
  generator: 'codex-imagegen',
  declaredModelPolicy: 'gpt-image-1.5',
  fallbackAuthorization: 'user-explicit',
  fallbackReason: 'chroma-transparency-gate-exhausted',
  evidenceLevel: 'workflow-attested'
});

export function isNativeTransparencyFallback(entry) {
  return entry?.generationMode === NATIVE_TRANSPARENCY_ATTESTATION.generationMode;
}

export function isSupportedGeneratedAttestation(entry) {
  if (!entry || entry.generator !== 'codex-imagegen' || entry.evidenceLevel !== 'workflow-attested') return false;
  if (!entry.generationMode) {
    return entry.declaredModelPolicy === 'gpt-image-2'
      && !entry.fallbackAuthorization
      && !entry.fallbackReason;
  }
  return isNativeTransparencyFallback(entry)
    && entry.declaredModelPolicy === 'gpt-image-1.5'
    && entry.fallbackAuthorization === 'user-explicit'
    && entry.fallbackReason === 'chroma-transparency-gate-exhausted'
    && ['master', 'action'].includes(entry.kind)
    && (entry.origin || 'generated') === 'generated';
}
