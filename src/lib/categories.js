// kind: 'income' | 'fixed' (bills you're committed to) | 'essential' (needed, variable)
//       | 'personal' (your "fun money") | 'savings' | 'transfer'
export const CATEGORIES = [
  { id: 'income', name: 'Income', kind: 'income', color: '#2e9e6a', icon: '💷' },
  { id: 'housing', name: 'Rent & Mortgage', kind: 'fixed', color: '#5b6bd6', icon: '🏠' },
  { id: 'bills', name: 'Bills & Utilities', kind: 'fixed', color: '#3d8fd1', icon: '💡' },
  { id: 'debt', name: 'Credit & Loans', kind: 'fixed', color: '#8a5cd1', icon: '💳' },
  { id: 'insurance', name: 'Insurance', kind: 'fixed', color: '#6d7fa3', icon: '🛡️' },
  { id: 'groceries', name: 'Groceries', kind: 'essential', color: '#3aa17e', icon: '🛒' },
  { id: 'transport', name: 'Transport', kind: 'essential', color: '#d18a2e', icon: '🚆' },
  { id: 'health', name: 'Health', kind: 'essential', color: '#cf5c7a', icon: '⚕️' },
  { id: 'childcare', name: 'Family & Kids', kind: 'essential', color: '#b0794a', icon: '🧸' },
  { id: 'eating_out', name: 'Eating Out', kind: 'personal', color: '#e0743a', icon: '🍽️' },
  { id: 'takeaway', name: 'Takeaways', kind: 'personal', color: '#e05a4f', icon: '🥡' },
  { id: 'shopping', name: 'Shopping', kind: 'personal', color: '#c84f9b', icon: '🛍️' },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'personal', color: '#7a63c9', icon: '🔁' },
  { id: 'entertainment', name: 'Entertainment', kind: 'personal', color: '#d6a51f', icon: '🎟️' },
  { id: 'personal_care', name: 'Personal Care', kind: 'personal', color: '#d47fb0', icon: '💇' },
  { id: 'fitness', name: 'Fitness', kind: 'personal', color: '#4fa3a3', icon: '🏋️' },
  { id: 'travel', name: 'Travel & Holidays', kind: 'personal', color: '#2f9bb8', icon: '✈️' },
  { id: 'gifts', name: 'Gifts & Charity', kind: 'personal', color: '#c9645e', icon: '🎁' },
  { id: 'cash', name: 'Cash', kind: 'personal', color: '#8c8c6a', icon: '💵' },
  { id: 'fees', name: 'Bank Fees & Interest', kind: 'fixed', color: '#b03a3a', icon: '⚠️' },
  { id: 'other', name: 'Other', kind: 'personal', color: '#8a8f98', icon: '•' },
  { id: 'savings', name: 'Savings & Investing', kind: 'savings', color: '#1f8f5f', icon: '🏦' },
  { id: 'transfer', name: 'Own-account Transfer', kind: 'transfer', color: '#9aa0a8', icon: '↔️' },
  { id: 'excluded', name: 'Excluded (not my spending)', kind: 'transfer', color: '#b4b8bd', icon: '🚫' },
];

export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const catName = (id) => CAT[id]?.name ?? 'Other';
export const catKind = (id) => CAT[id]?.kind ?? 'personal';
export const isSpendCategory = (id) => !['income', 'transfer', 'savings'].includes(catKind(id));
