// Step-by-step guidance per spending category: how to cut it, how to keep it down once it's lower,
// and where to go (official or well-established UK sites only).

const L = (name, url) => ({ name, url });
export const LINKS = {
  moneyhelperBudget: L('MoneyHelper: budget planner', 'https://www.moneyhelper.org.uk/en/everyday-money/budgeting/budget-planner'),
  emergency: L('MoneyHelper: how much emergency savings', 'https://www.moneyhelper.org.uk/en/savings/how-to-save/emergency-savings-how-much-is-enough'),
  isa: L('GOV.UK: ISAs explained', 'https://www.gov.uk/individual-savings-accounts'),
  lfhw: L('Love Food Hate Waste: recipes and storage tips', 'https://www.lovefoodhatewaste.com/'),
  tgtg: L('Too Good To Go: surplus food at a discount', 'https://www.toogoodtogo.com/en-gb'),
  olio: L('Olio: free food from neighbours and shops', 'https://olioapp.com/'),
  healthyStart: L('NHS Healthy Start: free milk, fruit and veg vouchers', 'https://www.healthystart.nhs.uk/'),
  bbcBudget: L('BBC Good Food: budget recipes', 'https://www.bbcgoodfood.com/recipes/collection/budget-recipes'),
  railcard: L('Railcards (Two Together, 26–30, Family)', 'https://www.railcard.co.uk/'),
  nationalRail: L('National Rail: split tickets and cheapest fares', 'https://www.nationalrail.co.uk/'),
  petrol: L('PetrolPrices: cheapest fuel near you', 'https://www.petrolprices.com/'),
  mot: L('GOV.UK: MOT history and reminders', 'https://www.gov.uk/check-mot-history'),
  topcashback: L('TopCashback: cashback on things you buy anyway', 'https://www.topcashback.co.uk/'),
  vinted: L('Vinted: sell clothes you don\'t wear', 'https://www.vinted.co.uk/'),
  bnpl: L('MoneyHelper: buy now pay later risks', 'https://www.moneyhelper.org.uk/en/everyday-money/credit/buy-now-pay-later'),
  giftAid: L('GOV.UK: Gift Aid adds 25% at no cost to you', 'https://www.gov.uk/donating-to-charity/gift-aid'),
  taxFreeChildcare: L('GOV.UK: Tax-Free Childcare (20% top-up)', 'https://www.gov.uk/tax-free-childcare'),
  childcareCalc: L('GOV.UK: childcare support calculator', 'https://www.childcarechoices.gov.uk/'),
  nctSales: L('NCT nearly new sales: cheap baby kit', 'https://www.nct.org.uk/nearly-new-sales'),
  childBenefit: L('GOV.UK: claim Child Benefit', 'https://www.gov.uk/child-benefit/how-to-claim'),
  libraries: L('GOV.UK: find your local library (free books, films, events)', 'https://www.gov.uk/local-library-services'),
  nhsPrescription: L('NHS prescription prepayment certificate', 'https://www.nhsbsa.nhs.uk/help-nhs-prescription-costs/prescription-prepayment-certificates-ppcs'),
  compare: L('Uswitch: compare broadband, mobile and energy', 'https://www.uswitch.com/'),
  socialTariffs: L('Ofcom: cheaper social broadband and phone tariffs', 'https://www.ofcom.org.uk/phones-and-broadband/saving-money/social-tariffs'),
  councilTax: L('GOV.UK: Council Tax Reduction', 'https://www.gov.uk/apply-council-tax-reduction'),
  insuranceCompare: L('MoneyHelper: cutting the cost of insurance', 'https://www.moneyhelper.org.uk/en/everyday-money/insurance'),
  travelSaving: L('MoneyHelper: saving for a holiday', 'https://www.moneyhelper.org.uk/en/savings/how-to-save'),
};

/** cut: steps to bring it down. keep: once it's lower. links: keys of LINKS. */
export const GUIDES = {
  groceries: {
    cut: [
      'Plan the week\'s meals on Sunday and shop from a list. Unplanned shops cost the most.',
      'Do one big shop and at most one top-up a week. Each extra trip adds £10–£20 of impulse buys.',
      'Swap to own-brand or "essentials" ranges for basics (pasta, rice, tins, cleaning). Usually 30–50% cheaper.',
      'Try Aldi or Lidl for one shop and compare the receipt.',
      'Use loyalty prices (Clubcard, Nectar) and compare price per kg on the shelf label, not the pack price.',
      'Cook in batches and freeze portions, and use up leftovers before buying more.',
    ],
    keep: ['Keep the shopping list habit: it\'s what usually makes the difference.', 'Set this month\'s spend as your groceries budget so you get a warning if it creeps back.'],
    links: ['lfhw', 'bbcBudget', 'tgtg', 'olio', 'healthyStart'],
  },
  eating_out: {
    cut: [
      'Decide your eating-out nights in advance (e.g. one a week) and treat the rest as cook-at-home.',
      'Use the per-day allowance on On track before you buy coffee or lunch.',
      'Take lunch to work 3 days a week: about £5–£8 a day saved.',
      'Swap one restaurant meal a month for a "fakeaway" at home.',
    ],
    keep: ['Lock the new level in as your budget.', 'Move the money you saved to savings on payday so it doesn\'t get spent elsewhere.'],
    links: ['bbcBudget', 'lfhw'],
  },
  takeaway: {
    cut: [
      'Delete saved cards from Deliveroo, Uber Eats and Just Eat so ordering takes effort.',
      'Turn off the apps\' promotional notifications.',
      'Keep 2–3 quick freezer meals for the nights you\'d normally order.',
      'If you do order, collect instead of delivery: no delivery or service fees.',
    ],
    keep: ['Set the new level as your takeaways budget.', 'Keep the apps off your home screen.'],
    links: ['bbcBudget', 'lfhw'],
  },
  transport: {
    cut: [
      'Train: get a Railcard (Two Together for couples, 26–30, Family). A third off most fares, and it pays for itself in a trip or two.',
      'Book rail in advance and try split tickets on National Rail or Trainline.',
      'Fuel: check the cheapest station near you before filling up; supermarket fuel is usually cheaper.',
      'Short Uber trips: check if a bus, bike or walking does the job.',
      'Car insurance and breakdown: compare at renewal rather than auto-renewing.',
    ],
    keep: ['Set the new level as your transport budget.', 'Put MOT and insurance renewal dates in your calendar so you compare in time.'],
    links: ['railcard', 'nationalRail', 'petrol', 'mot'],
  },
  shopping: {
    cut: [
      'Use a 48-hour rule for anything non-essential over £30: add it to a list and decide later.',
      'Unsubscribe from shop marketing emails and delete saved cards from shopping sites.',
      'Avoid Buy Now Pay Later for wants: it makes things feel cheaper than they are.',
      'Sell things you don\'t use (Vinted, eBay, Facebook Marketplace).',
      'When you do buy, go through a cashback site first.',
    ],
    keep: ['Set the new level as your shopping budget.', 'Keep a wish list and buy from it once a month.'],
    links: ['vinted', 'topcashback', 'bnpl'],
  },
  entertainment: {
    cut: ['Rotate streaming services: keep one at a time and switch monthly.', 'Check the iPhone\'s Settings → your name → Subscriptions for forgotten trials.', 'Use your local library for books, audiobooks (Libby) and films for free.'],
    keep: ['Keep the subscriptions you cancelled on your cancel list so they don\'t creep back.'],
    links: ['libraries'],
  },
  subscriptions: {
    cut: ['List every subscription (Bills page) and cancel anything not used in the last month.', 'Rotate streaming: one at a time.', 'Ask for loyalty or student/family prices before cancelling: many will offer one.'],
    keep: ['Re-check subscriptions every 3 months during the check-in.'],
    links: ['libraries'],
  },
  personal_care: {
    cut: ['Space out salon appointments a few weeks more.', 'Try supermarket own-brand toiletries.', 'Prescriptions: a prepayment certificate is cheaper if you need more than 2–3 items in 3 months.'],
    keep: ['Set the new level as your budget.'],
    links: ['nhsPrescription'],
  },
  gifts: {
    cut: ['Decide a yearly gifts budget (birthdays, Christmas) and divide it by 12: put that aside each month.', 'Suggest a family Secret Santa instead of buying for everyone.'],
    keep: ['If you give to church or charity, a fixed standing order you\'ve chosen deliberately is easier to plan around than one-off giving. If you\'re a taxpayer, Gift Aid adds 25% at no cost to you.'],
    links: ['giftAid'],
  },
  children: {
    cut: ['Buy baby and children\'s kit second-hand (NCT nearly new sales, Facebook Marketplace).', 'Claim everything you\'re entitled to: Child Benefit, Tax-Free Childcare (government adds 20%), and Healthy Start if eligible.'],
    keep: ['Set a monthly children budget so big one-offs don\'t surprise you.'],
    links: ['childBenefit', 'taxFreeChildcare', 'childcareCalc', 'nctSales', 'healthyStart'],
  },
  childcare: {
    cut: ['Use Tax-Free Childcare: for every £8 you pay in, the government adds £2 (up to £2,000 a year per child).', 'Check free hours you may be entitled to.'],
    keep: ['Review entitlements every September and January.'],
    links: ['taxFreeChildcare', 'childcareCalc'],
  },
  travel: {
    cut: ['Book trips early and be flexible on dates.', 'Save for holidays monthly in a separate pot instead of putting them on a card.'],
    keep: ['Keep a holiday savings pot going.'],
    links: ['railcard', 'travelSaving'],
  },
  bills: {
    cut: ['Mobile: out of contract? SIM-only is typically £8–£15 a month.', 'Broadband: ask for an out-of-contract price or switch; check social tariffs if you get benefits.', 'Energy: give meter readings and check you\'re on the cheapest tariff.', 'Council tax: check for a reduction.'],
    keep: ['Put contract end dates in your calendar.'],
    links: ['compare', 'socialTariffs', 'councilTax'],
  },
  insurance: {
    cut: ['Never auto-renew: compare at renewal and ask your insurer to match.', 'Pay annually if you can: monthly usually adds interest.', 'Check for policies you don\'t need (e.g. duplicate phone or gadget cover).'],
    keep: ['Put renewal dates in your calendar 3–4 weeks early: prices are lower then.'],
    links: ['insuranceCompare'],
  },
  other: {
    cut: ['Give these payments a proper category first (Categories page): the app can only spot patterns in what it can name.', 'Look at the biggest ones below and decide which were one-offs.'],
    keep: ['Keep "Other" small by categorising new payments during the monthly check-in.'],
    links: [],
  },
};

export const guideFor = (cat) => GUIDES[cat] || {
  cut: ['Look at the biggest payments below and decide which you can cut, delay or switch.', 'Set a budget for this category so you get a warning before you go over.'],
  keep: ['Set the new level as your budget.'],
  links: [],
};
