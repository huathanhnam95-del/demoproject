'use strict';

const RATE_CARD_VERSION = '2026.09.v1';

const PACKAGES = {
  'speaking.acoustic.fixed.v1': {
    packageId: 'speaking.acoustic.fixed.v1',
    packageVersion: '1.0.0',
    rateCardVersion: RATE_CARD_VERSION,
    kind: 'speaking',
    allowedModes: ['read_aloud', 'repeat_sentence'],
    creditsPerMinute: 15,
    fixedComponentCredits: 0,
    status: 'active',
    includedComponents: ['pronunciation', 'fluency', 'prosody']
  },
  'speaking.acoustic.transcript.v1': {
    packageId: 'speaking.acoustic.transcript.v1',
    packageVersion: '1.0.0',
    rateCardVersion: RATE_CARD_VERSION,
    kind: 'speaking',
    allowedModes: ['retell_lecture', 'summarize_group_discussion', 'respond_to_situation', 'respond_to_a_situation', 'describe_image', 'di'],
    creditsPerMinute: 25,
    fixedComponentCredits: 0,
    status: 'active',
    includedComponents: ['stt_transcription', 'pronunciation', 'fluency', 'prosody']
  },
  'writing.essay.standard.v1': {
    packageId: 'writing.essay.standard.v1',
    packageVersion: '1.0.0',
    rateCardVersion: RATE_CARD_VERSION,
    kind: 'writing',
    allowedModes: ['write_essay', 'essay'],
    fixedCredits: 10,
    status: 'active',
    includedComponents: ['content', 'grammar', 'vocabulary', 'structure']
  },
  'writing.swt.standard.v1': {
    packageId: 'writing.swt.standard.v1',
    packageVersion: '1.0.0',
    rateCardVersion: RATE_CARD_VERSION,
    kind: 'writing',
    allowedModes: ['summarize_written_text', 'swt'],
    fixedCredits: 10,
    status: 'active',
    includedComponents: ['form', 'content', 'grammar', 'vocabulary']
  },
  'writing.sst.standard.v1': {
    packageId: 'writing.sst.standard.v1',
    packageVersion: '1.0.0',
    rateCardVersion: RATE_CARD_VERSION,
    kind: 'writing',
    allowedModes: ['summarize_spoken_text', 'sst'],
    fixedCredits: 10,
    status: 'active',
    includedComponents: ['content', 'form', 'grammar', 'vocabulary', 'spelling']
  }
};

function getPackageConfig(packageId) {
  const pkg = PACKAGES[packageId];
  if (!pkg || pkg.status !== 'active') {
    return null;
  }
  return { ...pkg };
}

function resolvePackageForMode(mode, preferredPackageId = null) {
  if (preferredPackageId && PACKAGES[preferredPackageId]) {
    const pkg = PACKAGES[preferredPackageId];
    if (pkg.status === 'active' && pkg.allowedModes.includes(mode)) {
      return { ...pkg };
    }
  }

  for (const pkg of Object.values(PACKAGES)) {
    if (pkg.status === 'active' && pkg.allowedModes.includes(mode)) {
      return { ...pkg };
    }
  }
  return null;
}

module.exports = {
  RATE_CARD_VERSION,
  PACKAGES,
  getPackageConfig,
  resolvePackageForMode
};
