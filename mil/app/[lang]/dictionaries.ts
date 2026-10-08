export const locales = ['bn', 'en'] as const;
export type Locale = (typeof locales)[number];
export const hasLocale = (l: string): l is Locale => (locales as readonly string[]).includes(l);

const bn = {
  brand: 'বাসা',
  brandAccent: 'বুক',
  switchLang: 'English',
  themeToggle: 'লাইট বা ডার্ক থিম',
  metaTitle: 'বাসাবুক · বাসার হিসাব, ঝামেলা ছাড়া',
  metaDesc: 'কে কয় বেলা খেল, কে কত বাজার করল, কে কত পাবে। ফ্ল্যাটের সব হিসাব এক জায়গায়।',
  heroTitle: 'ফ্ল্যাটের হিসাব নিয়ে আর ঝামেলা নেই।',
  heroBody: 'কে কত মিল খেল, বাজারে কে কত দিল, আর কার কত টাকা পাওনা, সব হিসাব এক জায়গায়।',
  create: 'ফ্ল্যাট তৈরি করুন',
  joinLead: 'ফ্ল্যাটে যোগ দিচ্ছেন?',
  joinCta: 'লিংক দিয়ে সরাসরি যোগ দিন →',
  khata: {
    title: 'অক্টোবরের হিসাব',
    rows: [
      ['2 October', 'বাজার · নাফিস', '2,450'],
      ['5 October', 'বাজার · তাহসিন', '1,980'],
      ['9 October', 'বাজার · জারিফ', '2,120'],
    ],
    totalBazar: 'মোট বাজার',
    totalMeals: 'মোট মিল',
    mealRate: 'মিল রেট',
    caption: 'মিল রেট = মোট বাজার ÷ মোট মিল',
    figures: { totalBazar: '6,550', totalMeals: '206.5', rate: '31.72', food: '714', bills: '316', paid: '2,120', result: '1,090' },
    you: { who: 'জারিফের হিসাব, 9 October পর্যন্ত', food: 'খাবার (22.5 মিল)', bills: 'বিলের ভাগ', paid: 'জমা দিয়েছে', result: 'ফেরত পাবে' },
  },
  cookTitle: 'রাঁধুনির ফোনে যা যায়',
  cookBody: 'প্রতি রাত দশটায় কাল কয়জন খাবে, সেটা রাঁধুনির ফোনে চলে যায়। তাঁর কোনো অ্যাপ লাগে না।',
  cookCard: { when: 'আগামীকাল', b: 'সকাল', l: 'দুপুর', d: 'রাত', counts: ['7', '8', '9'] },
  settleTitle: 'মাস শেষে সোজা মেসেঞ্জার গ্রুপে',
  settleBody: 'মাস ক্লোজ করলেই কে কত দেবে আর কে কত পাবে, সেই মেসেজ রেডি। এক ট্যাপে গ্রুপে পাঠিয়ে দিন।',
  settleMsg: ['অক্টোবরের হিসাব', 'মিল রেট ৳31.72', 'নাফিস পাবে ৳420', 'তাহসিন দেবে ৳310', 'জারিফ দেবে ৳110'],
  modesTitle: 'বন্ধু হোক বা অচেনা',
  modes: [
    { name: 'বন্ধুদের ফ্ল্যাট', points: ['যে কেউ এন্ট্রি দিলে সাথে সাথে যোগ হয়', 'রাত দশটার পরের বদলে দেরির চিহ্ন পড়ে'] },
    { name: 'অচেনাদের ফ্ল্যাট', points: ['বাজারের এন্ট্রি ম্যানেজার মিলিয়ে দেখেন', 'রাত দশটার পরের বদলে ম্যানেজারের অনুমতি লাগে'] },
  ],
  priceTitle: 'দাম',
  priceLine: 'পুরো ফ্ল্যাটের জন্য মাসে ৳199',
  priceNote: 'প্রথম মাস ফ্রি। আলাদা করে কাউকে কিছু দিতে হবে না।',
  faqTitle: 'প্রশ্ন',
  faq: [
    ['সবাইকে কি অ্যাপ ডাউনলোড করতে হবে?', 'না। লিংকে ট্যাপ করলেই খুলে যায়। চাইলে হোম স্ক্রিনে রেখে অ্যাপের মতো ব্যবহার করা যায়।'],
    ['বাসাবুক কি আমাদের টাকা রাখে?', 'না। টাকা যায় সরাসরি ম্যানেজারের বিকাশে। বাসাবুক শুধু TrxID দিয়ে হিসাবটা রাখে।'],
    ['আইফোনে চলবে?', 'হ্যাঁ, অ্যান্ড্রয়েড আর আইফোন দুটোতেই চলে।'],
  ],
  footer: 'বাসাবুক · শেয়ার্ড ফ্ল্যাটের হিসাব',
};

export type Dict = typeof bn;

const en: Dict = {
  brand: 'BashaBook',
  brandAccent: '',
  switchLang: 'বাংলা',
  themeToggle: 'Light or dark theme',
  metaTitle: 'BashaBook · Run your flat without the daily hassle',
  metaDesc: 'Meal counts, the cook’s headcount, bazar, bills and month-end dues, worked out for everyone in the flat.',
  heroTitle: 'Run your flat without the daily hassle.',
  heroBody: 'Who ate how many meals, who spent what on bazar, who owes whom. BashaBook keeps the books, without the notebook or the month-end arguments.',
  create: 'Create your flat',
  joinLead: 'Already have an invite?',
  joinCta: 'Join a flat →',
  khata: {
    title: 'October ledger',
    rows: [
      ['2 Oct', 'Bazar · Nafis', '2,450'],
      ['5 Oct', 'Bazar · Tahsin', '1,980'],
      ['9 Oct', 'Bazar · Zarif', '2,120'],
    ],
    totalBazar: 'Total bazar',
    totalMeals: 'Total meals',
    mealRate: 'Meal rate',
    caption: 'Meal rate = total bazar ÷ total meals',
    figures: { totalBazar: '6,550', totalMeals: '206.5', rate: '31.72', food: '714', bills: '316', paid: '2,120', result: '1,090' },
    you: { who: 'Zarif · as of 9 Oct', food: 'Food (22.5 meals)', bills: 'Share of bills', paid: 'Paid', result: 'Gets back' },
  },
  cookTitle: 'What your cook sees',
  cookBody: 'At 10 pm, tomorrow’s count reaches the cook’s phone. No app needed on their side.',
  cookCard: { when: 'Tomorrow', b: 'Breakfast', l: 'Lunch', d: 'Dinner', counts: ['7', '8', '9'] },
  settleTitle: 'Month end, in your Messenger group',
  settleBody: 'Close the month and the who-owes-what message is ready. Send it to the group in one tap.',
  settleMsg: ['October accounts', 'Meal rate ৳31.72', 'Nafis gets ৳420', 'Tahsin pays ৳310', 'Zarif pays ৳110'],
  modesTitle: 'Friends or strangers',
  modes: [
    { name: 'A flat of friends', points: ['Entries count straight away', 'Changes after the cutoff are marked late'] },
    { name: 'A flat of strangers', points: ['The manager checks bazar entries', 'Changes after the cutoff need the manager’s approval'] },
  ],
  priceTitle: 'Price',
  priceLine: '৳199 a month for the whole flat',
  priceNote: 'First month free. Members pay nothing.',
  faqTitle: 'Questions',
  faq: [
    ['Do members need to install an app?', 'No. The link opens in the browser. They can add it to the home screen to open it like an app.'],
    ['Does BashaBook hold our money?', 'No. Money goes to the manager’s bKash. BashaBook only records it by TrxID.'],
    ['Does it work on iPhone?', 'Yes, on Android and iPhone.'],
  ],
  footer: 'BashaBook · accounts for shared flats',
};

export const getDictionary = (l: Locale): Dict => (l === 'bn' ? bn : en);
