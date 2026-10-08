/** Isi berkas .txt yang diunduh pengguna. Tidak memuat master password. */
export function recoveryFileText(recoveryKey: string, email: string | null | undefined) {
  return [
    'KUNCI PEMULIHAN — SANDI TASKIFY',
    email ? `Akun   : ${email}` : null,
    `Dibuat : ${new Date().toISOString().slice(0, 10)}`,
    '',
    recoveryKey,
    '',
    'Gunakan kunci ini bila lupa master password (layar kunci → "Lupa master password?").',
    'Simpan di tempat aman dan TERPISAH dari perangkat ini (dicetak, atau di pengelola',
    'sandi lain). Siapa pun yang memegang kunci ini beserta data terenkripsi Anda dapat',
    'membuka brankas. Tanpa master password DAN kunci ini, tidak ada yang bisa memulihkan data.',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');
}
