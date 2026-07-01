const ensureUserAccessColumns = async (query) => {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_luxury BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tutor_grade VARCHAR(5) DEFAULT 'B'`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS luxury_since TIMESTAMP`);
};

const packageText = (registration = {}) =>
  `${registration.package_group || ''} ${registration.package_name || ''}`.toLowerCase();

const isLuxuryPackage = (registration = {}) => {
  return packageText(registration).includes('luxury');
};

const isVipPackage = (registration = {}) => {
  const value = packageText(registration);
  return value.includes('vip') || isLuxuryPackage(registration);
};

const getAccessFromRegistration = (registration = {}) => {
  const isLuxury = isLuxuryPackage(registration);
  return {
    isLuxury,
    isVip: isVipPackage(registration),
    luxurySinceSql: isLuxury ? 'NOW()' : 'NULL',
  };
};

module.exports = {
  ensureUserAccessColumns,
  isLuxuryPackage,
  isVipPackage,
  getAccessFromRegistration,
};
