// Where to go to cancel, manage or get help: official sites only. Phone numbers are included only
// for national services whose numbers are long-standing (government lines and free debt charities);
// for companies we link to their own help pages, which show the current number.

export const HELP = {
  stepchange: { name: 'StepChange (free debt advice)', url: 'https://www.stepchange.org/', tel: '0800 138 1111' },
  moneyhelper: { name: 'MoneyHelper (free, government-backed)', url: 'https://www.moneyhelper.org.uk/', tel: '0800 011 3797' },
  nationaldebtline: { name: 'National Debtline (free)', url: 'https://nationaldebtline.org/', tel: '0808 808 4000' },
  hmrcPay: { name: 'HMRC: difficulties paying (Time to Pay)', url: 'https://www.gov.uk/difficulties-paying-hmrc', tel: '0300 200 3835' },
  childBenefit: { name: 'Claim Child Benefit', url: 'https://www.gov.uk/child-benefit/how-to-claim', tel: '0300 200 3100' },
  councilTax: { name: 'Apply for Council Tax Reduction', url: 'https://www.gov.uk/apply-council-tax-reduction' },
  benefitsCheck: { name: 'Free benefits calculators', url: 'https://www.gov.uk/benefits-calculators' },
  cass: { name: 'Current Account Switch Service', url: 'https://www.currentaccountswitch.co.uk/' },
  ofgemSwitch: { name: 'Ofgem: switching energy supplier', url: 'https://www.ofgem.gov.uk/information-consumers/energy-advice-households/switching-energy-supplier' },
  compare: { name: 'Compare broadband, mobile and energy (Uswitch)', url: 'https://www.uswitch.com/' },
  socialTariffs: { name: 'Ofcom: cheaper social broadband and phone tariffs', url: 'https://www.ofcom.org.uk/phones-and-broadband/saving-money/social-tariffs' },
};

// Merchants: matched on the statement name. `how` is a one-line instruction.
const MERCHANTS = [
  [/NETFLIX/, 'Netflix', 'https://www.netflix.com/cancelplan', 'Account → Cancel membership. You keep it until the end of the paid month.'],
  [/SPOTIFY/, 'Spotify', 'https://www.spotify.com/uk/account/overview/', 'Account → Manage plan → Cancel Premium.'],
  [/DISNEY/, 'Disney+', 'https://www.disneyplus.com/account', 'Account → Subscription → Cancel.'],
  [/AMAZON PRIME|PRIME VIDEO|AMZN.*PRIME|PRIMEVIDEO/, 'Amazon Prime', 'https://www.amazon.co.uk/prime', 'Your Account → Prime membership → End membership (add-ons such as ad-free are under Prime Video settings).'],
  [/APPLE\.COM|APPLE COM|ITUNES|ICLOUD/, 'Apple subscriptions', 'https://support.apple.com/en-gb/HT202039', 'On the iPhone: Settings → your name → Subscriptions. Each Apple charge on a statement is one of these.'],
  [/GOOGLE ONE|GOOGLE STORAGE|GOOGLE \*/, 'Google', 'https://one.google.com/', 'Google One → Settings → Cancel membership (or Play Store → Subscriptions).'],
  [/YOUTUBE/, 'YouTube Premium', 'https://www.youtube.com/paid_memberships', 'Paid memberships → Deactivate.'],
  [/AUDIBLE/, 'Audible', 'https://www.audible.co.uk/', 'Account details → Cancel membership (you keep bought titles).'],
  [/NOW ?TV/, 'NOW', 'https://help.nowtv.com/', 'My Account → Memberships → Cancel.'],
  [/\bSKY\b/, 'Sky', 'https://www.sky.com/help', 'Call or chat via Sky help. Ask for the retentions team: they often offer a lower price to stay.'],
  [/\bO2\b|TELEFONICA/, 'O2', 'https://www.o2.co.uk/help', 'Out of contract? Move to SIM-only in My O2, or text PAC to 65075 to switch network and keep your number.'],
  [/\bEE\b/, 'EE', 'https://ee.co.uk/help', 'Check your contract end date in the EE app; ask for an out-of-contract price or switch.'],
  [/VIRGIN MEDIA/, 'Virgin Media', 'https://www.virginmedia.com/help', 'Out of contract? Ask for a new-customer price or switch.'],
  [/\bBT\b/, 'BT', 'https://www.bt.com/help', 'Check your contract end date; ask for a better price or switch.'],
  [/VODAFONE/, 'Vodafone', 'https://www.vodafone.co.uk/help-and-information', 'Out of contract? Move to SIM-only or switch (text PAC to 65075).'],
  [/PURE ?GYM/, 'PureGym', 'https://www.puregym.com/', 'In the PureGym app/members area you can freeze or cancel your membership.'],
  [/LINKEDIN/, 'LinkedIn Premium', 'https://www.linkedin.com/help/linkedin', 'Me → Premium features → Manage Premium account → Cancel subscription.'],
  [/REVOLUT/, 'Revolut plan', 'https://www.revolut.com/help/', 'In the Revolut app: Profile → Plan → change to Standard (free).'],
  [/BUPA/, 'Bupa', 'https://www.bupa.co.uk/', 'If your employer gives you private medical cover, cancel the personal policy (check what it covers first).'],
  [/OCTOPUS|BRITISH GAS|E\.?ON|EDF|OVO|SCOTTISH POWER|SSE/, 'Energy supplier', HELP.ofgemSwitch.url, 'Give a meter reading, check you\'re on the cheapest tariff, and compare. Switching is free and takes about 5 working days.'],
  [/AQUA|NEWDAY/, 'Aqua', 'https://www.aquacard.co.uk/', 'In the Aqua app: set a fixed Direct Debit you can always cover (not "full balance" if it bounces).'],
  [/CAPITAL ONE/, 'Capital One', 'https://www.capitalone.co.uk/', 'Pay enough to get under the limit; set a Direct Debit for at least the minimum.'],
  [/AMERICAN EXPRESS|\bAMEX\b/, 'American Express', 'https://www.americanexpress.com/uk/', 'Set up a Direct Debit for at least the minimum in the Amex app.'],
  [/HMRC/, 'HMRC', HELP.hmrcPay.url, 'Call the Payment Support Service to change a Time to Pay arrangement.'],
];

/** Help for a merchant name from a statement, or null. */
export function helpFor(name) {
  const n = String(name || '').toUpperCase();
  for (const [re, label, url, how] of MERCHANTS) if (re.test(n)) return { label, url, how };
  return null;
}
