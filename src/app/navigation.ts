import {
  CalendarDays,
  CodeXml,
  House,
  KeyRound,
  ListChecks,
  NotebookPen,
  Settings,
  StickyNote,
  Trophy,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Kelas gradasi modul (lihat styles/index.css) */
  gradient: string;
  /** Tampil di bottom nav HP */
  mobile: boolean;
}

/**
 * Satu-satunya daftar navigasi. Dipakai sidebar (desktop) & bottom nav (HP).
 * Urutan bottom nav: Kalender sengaja di tengah → "pusat" aplikasi.
 * Hanya item `mobile: true` yang tampil di bottom nav, jadi urutan sidebar bebas.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Beranda', icon: House, gradient: 'bg-gradient-brand', mobile: true },
  { to: '/tugas', label: 'Tugas', icon: ListChecks, gradient: 'bg-gradient-tasks', mobile: true },
  {
    to: '/kalender',
    label: 'Kalender',
    icon: CalendarDays,
    gradient: 'bg-gradient-calendar',
    mobile: true,
  },
  {
    to: '/jurnal',
    label: 'Jurnal',
    icon: NotebookPen,
    gradient: 'bg-gradient-journal',
    mobile: true,
  },
  {
    to: '/keuangan',
    label: 'Keuangan',
    icon: Wallet,
    gradient: 'bg-gradient-finance',
    mobile: true,
  },
  // Bottom nav HP sudah 5 item (dan header HP kehabisan lebar), jadi Catatan hanya di sidebar.
  // Di HP: kartu Beranda, panel hari Kalender, dan palet perintah (Ctrl/⌘ K).
  {
    to: '/catatan',
    label: 'Catatan',
    icon: StickyNote,
    gradient: 'bg-gradient-notes',
    mobile: false,
  },
  {
    to: '/review',
    label: 'Review',
    icon: Trophy,
    gradient: 'bg-gradient-brand',
    mobile: false,
  },
  {
    to: '/vault',
    label: 'Vault Kode',
    icon: CodeXml,
    gradient: 'bg-gradient-vault',
    mobile: false,
  },
  {
    to: '/sandi',
    label: 'Sandi',
    icon: KeyRound,
    gradient: 'bg-gradient-sandi',
    mobile: false,
  },
  {
    to: '/pengaturan',
    label: 'Pengaturan',
    icon: Settings,
    gradient: 'bg-gradient-settings',
    mobile: false,
  },
];

export const findNavItem = (path: string) => NAV_ITEMS.find((item) => item.to === path);
