// =============================================
// Program -> Google Drive learning-material links.
// Keyed by normalised program name (lowercase, single-spaced). Aliases point to
// the same URL so DB variants (e.g. "TOEFL" vs "TOEFL Preparation") resolve too.
// A member only ever sees the link for a program they are enrolled in.
// =============================================

const MODULE_LINKS = {
  'walky talky': 'https://drive.google.com/file/d/1iIIl-bKQHt3d_neBzc8gJYWKtHYIf63C/view?usp=sharing',
  'speak up 1': 'https://drive.google.com/file/d/1P0sVsaISde3oznX3tk6XkC-FP_E1hUQu/view?usp=sharing',
  'speak up 2': 'https://drive.google.com/file/d/1nHg_j0gZIOFbukYOATVNXf3BmPjJ8W96/view?usp=sharing',
  'speak up 3': 'https://drive.google.com/file/d/1h_xUadFxdsgU8kCYaL4lHDsMb7xbhG83/view?usp=sharing',
  'speak up 100': 'https://drive.google.com/file/d/1JrrBL0A-ifflWgCxO3r8uohAvssGfECT/view?usp=sharing',
  'grand speaking': 'https://drive.google.com/file/d/1QFJ4Ex4ShC6aOZejdUy-kUWadnK_4nXV/view?usp=sharing',
  'grammar': 'https://drive.google.com/file/d/1UAMNjfTUy_y3Ki3x1XVQKAGK6zLvTvJl/view?usp=sharing',
  'grammar lv 1': 'https://drive.google.com/file/d/1UAMNjfTUy_y3Ki3x1XVQKAGK6zLvTvJl/view?usp=sharing',
  'ielts': 'https://drive.google.com/drive/folders/11oegKW3BHIWKf84PoBndmN-r6v6zV8Nd?usp=sharing',
  'ielts mastery': 'https://drive.google.com/drive/folders/11oegKW3BHIWKf84PoBndmN-r6v6zV8Nd?usp=sharing',
  'toefl': 'https://drive.google.com/drive/folders/1cnSF5FTdg-3VqOOEKygNQNSVJZhVTxmC?usp=sharing',
  'toefl preparation': 'https://drive.google.com/drive/folders/1cnSF5FTdg-3VqOOEKygNQNSVJZhVTxmC?usp=sharing',
  'career clinic': 'https://drive.google.com/drive/folders/1h_vJWZ9DS7nAUX-6dVJ_8NZXW54AfRWu?usp=sharing',
  'smart kids': 'https://drive.google.com/file/d/12QVtsFtpRqxRogwoUshkxdixYl48nX9o/view?usp=sharing',
  'super kids': 'https://drive.google.com/file/d/1H2lB6GRbZuweTmtDj9BRuXckdo7eaUFK/view?usp=sharing',
  'genius teen': 'https://drive.google.com/file/d/182ucR6Sd52h-wwxOiAlD0h-gq_XCmDSy/view?usp=sharing',
  'genius teens': 'https://drive.google.com/file/d/182ucR6Sd52h-wwxOiAlD0h-gq_XCmDSy/view?usp=sharing',
  'paket ramadan': 'https://drive.google.com/drive/folders/114kvaYQFaqwOvy2klDqH_xMko1hr9Nsi?usp=sharing',
  'smart holiday sd': 'https://drive.google.com/file/d/1o6LvAX23bgmzBTHtXZ-ZTDjayAY3Mmbs/view?usp=sharing',
  'smart holiday smp/sma': 'https://drive.google.com/file/d/14Pk9CRZnElmBWUsNaRqYc7XyJbfv0k-H/view?usp=sharing',
};

// =============================================
// Modul khusus paket Luxury Class. Member Luxury TIDAK menerima modul biasa —
// hanya daftar di bawah ini. Kunci memakai nama program yang dinormalisasi,
// dengan alias untuk varian nama di DB.
// =============================================

const LUXURY_MODULE_LINKS = {
  'speak up 1': 'https://drive.google.com/file/d/1LDmzSHL84fFrFm2xanKocpHZ2iHLH4Um/view?usp=sharing',
  'speak up 2': 'https://drive.google.com/file/d/1tkVBkYLnuc8oM_Z4RDUlq1trilBe4D_S/view?usp=sharing',
  'grand speaking': 'https://drive.google.com/file/d/1rfymIePIuX0TTWw-aMLnwy3T_mkOENOe/view?usp=sharing',
  'smart kids': 'https://drive.google.com/file/d/1HxmMSYU_Q2ZpaAw1-p16G5emrN82uJAs/view?usp=sharing',
  'speak up 100': 'https://drive.google.com/file/d/1kCW7jNW-pIWDZprEoBqIi6XkIqojGW7_/view?usp=sharing',
  'walky talky': 'https://drive.google.com/file/d/1pDrjEH1uxz3JM0N6OsfEsN012yTTykBl/view?usp=sharing',
  'structure toefl': 'https://drive.google.com/file/d/1HKUNSRSeHeIQ2Ns7c9crif1IbykeKpJD/view?usp=sharing',
  // 'Structure TOEFL' bukan nama program di DB; modul ini dipakai untuk program TOEFL.
  'toefl': 'https://drive.google.com/file/d/1HKUNSRSeHeIQ2Ns7c9crif1IbykeKpJD/view?usp=sharing',
  'toefl preparation': 'https://drive.google.com/file/d/1HKUNSRSeHeIQ2Ns7c9crif1IbykeKpJD/view?usp=sharing',
  'genius teen': 'https://drive.google.com/file/d/1QAIRPFIDeWyDs1bVTwZxX1dPcSwS1ne-/view?usp=sharing',
  'genius teens': 'https://drive.google.com/file/d/1QAIRPFIDeWyDs1bVTwZxX1dPcSwS1ne-/view?usp=sharing',
};

// Label tampilan per modul luxury (nama modul, bukan nama program).
const LUXURY_MODULE_TITLES = {
  'speak up 1': 'Speak Up 1',
  'speak up 2': 'Speak Up 2',
  'grand speaking': 'Grand Speaking',
  'smart kids': 'Smart Kids',
  'speak up 100': 'Speak Up 100',
  'walky talky': 'Walky Talky',
  'structure toefl': 'Structure TOEFL',
  'toefl': 'Structure TOEFL',
  'toefl preparation': 'Structure TOEFL',
  'genius teen': 'Genius Teen',
  'genius teens': 'Genius Teen',
};

const normalizeProgramName = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

const getModuleMaterial = (programName) => MODULE_LINKS[normalizeProgramName(programName)] || null;

// Modul luxury untuk sebuah program. null = program itu belum punya modul luxury.
const getLuxuryModuleMaterial = (programName) => LUXURY_MODULE_LINKS[normalizeProgramName(programName)] || null;

const getLuxuryModuleTitle = (programName) =>
  LUXURY_MODULE_TITLES[normalizeProgramName(programName)] || String(programName || '').trim();

module.exports = {
  MODULE_LINKS,
  LUXURY_MODULE_LINKS,
  LUXURY_MODULE_TITLES,
  getModuleMaterial,
  getLuxuryModuleMaterial,
  getLuxuryModuleTitle,
  normalizeProgramName,
};
