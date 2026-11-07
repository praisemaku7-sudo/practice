// Realistic sample data so the app can be explored before importing real statements.
import { iso, addMonths, monthKey, daysInMonth, todayISO } from './dates.js';

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

export function demoData(today = todayISO()) {
  const r = rng(42);
  const accounts = [
    { id: 'demo-main', name: 'Main Current', bank: 'Monzo', type: 'current' },
    { id: 'demo-old', name: 'Old Current', bank: 'Barclays', type: 'current' },
    { id: 'demo-card', name: 'Credit Card', bank: 'Amex', type: 'credit' },
    { id: 'demo-save', name: 'Easy Saver', bank: 'Chip', type: 'savings' },
  ];
  const rows = [];
  const add = (acc, date, description, pounds) => rows.push({ accountId: acc, date, description, amount: Math.round(pounds * 100) });
  const cur = monthKey(today);
  for (let i = 4; i >= 0; i--) {
    const m = addMonths(cur, -i);
    const [y, mo] = m.split('-').map(Number);
    const dim = daysInMonth(m);
    const last = i === 0 ? +today.slice(8) : dim;
    const d = (day) => iso(y, mo, Math.min(day, dim));
    const inMonth = (day) => day <= last;
    if (inMonth(25)) add('demo-main', d(25), 'ACME LTD SALARY BGC', 2850);
    if (inMonth(1)) add('demo-old', d(1), 'OPENRENT LTD STO RENT', -1150);
    if (inMonth(3)) add('demo-old', d(3), 'OCTOPUS ENERGY DD', i < 1 ? -112 : -98);
    if (inMonth(5)) add('demo-old', d(5), 'LONDON BOROUGH COUNCIL TAX DD', -142);
    if (inMonth(7)) add('demo-main', d(7), 'VODAFONE LTD DD', -24);
    if (inMonth(8)) add('demo-card', d(8), 'NETFLIX.COM', -12.99);
    if (inMonth(12)) add('demo-card', d(12), 'SPOTIFY UK', -11.99);
    if (inMonth(14)) add('demo-card', d(14), 'DISNEY PLUS', -7.99);
    if (inMonth(9)) add('demo-main', d(9), 'PUREGYM LTD DD', -29.99);
    if (inMonth(15)) add('demo-old', d(15), 'THAMES WATER DD', -38);
    if (inMonth(18)) add('demo-old', d(18), 'ADMIRAL INSURANCE DD', -46.5);
    if (inMonth(26)) add('demo-main', d(26), 'TRANSFER TO EASY SAVER', -300);
    if (inMonth(26)) add('demo-save', d(26), 'TRANSFER FROM MAIN CURRENT', 300);
    if (inMonth(20)) add('demo-main', d(20), 'AMEX PAYMENT DD', -420);
    if (inMonth(20)) add('demo-card', d(20), 'PAYMENT RECEIVED - THANK YOU', 420);
    for (let day = 1; day <= last; day++) {
      if (r() < 0.28) add('demo-main', d(day), ['TESCO STORES', 'SAINSBURYS S/MKT', 'LIDL GB', 'ALDI STORES'][Math.floor(r() * 4)], -(8 + r() * 45));
      if (r() < 0.55) add('demo-main', d(day), 'TFL TRAVEL CH', -(2.8 + Math.floor(r() * 3) * 2.8));
      if (r() < 0.35) add('demo-main', d(day), ['PRET A MANGER', 'COSTA COFFEE', 'GREGGS'][Math.floor(r() * 3)], -(2.5 + r() * 4));
      if (r() < (i === 0 ? 0.25 : 0.14)) add('demo-card', d(day), ['DELIVEROO', 'UBER EATS', 'JUST EAT'][Math.floor(r() * 3)], -(14 + r() * 22));
      if (r() < 0.08) add('demo-card', d(day), ['DISHOOM', 'WAGAMAMA', 'THE CROWN PUB'][Math.floor(r() * 3)], -(22 + r() * 40));
      if (r() < 0.1) add('demo-card', d(day), ['AMAZON.CO.UK', 'ASOS.COM', 'ZARA UK', 'ARGOS'][Math.floor(r() * 4)], -(9 + r() * 70));
      if (r() < 0.04) add('demo-main', d(day), ['ODEON CINEMAS', 'TICKETMASTER'][Math.floor(r() * 2)], -(12 + r() * 50));
      if (r() < 0.03) add('demo-main', d(day), 'BOOTS', -(4 + r() * 20));
    }
    if (i === 1 && inMonth(16)) add('demo-card', d(16), 'RYANAIR', -189.98);
  }
  const balances = { 'demo-main': 1284_50, 'demo-old': 412_10, 'demo-card': -386_22, 'demo-save': 2400_00 };
  return { accounts, rows, balances };
}
