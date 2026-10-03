export const normalizeThaiMobilePhone = (value: string): string | null => {
  if (!/^[+\d()\s-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  const localNumber = digits.startsWith('66') ? `0${digits.slice(2)}` : digits;

  return /^0[689]\d{8}$/.test(localNumber) ? localNumber : null;
};

export const getThaiMobilePhoneVariants = (value: string): string[] => {
  const localNumber = normalizeThaiMobilePhone(value);
  if (!localNumber) return [];

  const digits = localNumber.slice(1);
  const formattedLocalNumber = `${localNumber.slice(0, 3)}-${localNumber.slice(3, 6)}-${localNumber.slice(6)}`;
  const internationalNumber = `+66${digits}`;
  const formattedInternationalNumber = `+66${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;

  return Array.from(new Set([
    value.trim(),
    localNumber,
    formattedLocalNumber,
    internationalNumber,
    formattedInternationalNumber,
  ]));
};
