export const locales = ['bn', 'en'] as const;
export type Locale = (typeof locales)[number];
export const hasLocale = (l: string): l is Locale => (locales as readonly string[]).includes(l);

const bn = {
  brand: 'BashaBook',
  switchLang: 'English',
  themeToggle: 'লাইট বা ডার্ক থিম',
  metaTitle: 'BashaBook · ফ্ল্যাটের হিসাব, নিজে নিজেই',
  metaDesc: 'মিল গোনা, রাঁধুনির হেডকাউন্ট, বাজার, বিল আর মাসশেষের হিসাব, ফ্ল্যাটের সবার জন্য।',
  heroTitle: 'ফ্ল্যাটের হিসাব, এখন নিজে নিজেই।',
  heroBody: 'কে কয় বেলা খেল, কে কত টাকার বাজার করল, কার কাছে কত পাওনা, BashaBook সব হিসাব রাখে। খাতা-কলম আর মাসশেষের ঝামেলা ছাড়াই।',
  create: 'আপনার ফ্ল্যাট খুলুন',
  joinLead: 'ইনভাইট পেয়েছেন?',
  joinCta: 'ফ্ল্যাটে যোগ দিন →',
  khata: {
    title: 'অক্টোবরের খাতা',
    rows: [
      ['2 অক্টো', 'বাজার · রহিম', '2,450'],
      ['5 অক্টো', 'বাজার · করিম', '1,980'],
      ['9 অক্টো', 'বাজার · ফাহিম', '2,120'],
    ],
    totalBazar: 'মোট বাজার',
    totalMeals: 'মোট মিল',
    mealRate: 'মিল রেট',
    caption: 'মিল রেট = মোট বাজার ÷ মোট মিল। অ্যাপে প্রতিটা সংখ্যার হিসাব খুলে দেখা যায়।',
    you: { who: 'ফাহিম · 9 অক্টো পর্যন্ত', food: 'খাবার (22.5 মিল)', bills: 'বিলের ভাগ', paid: 'দিয়েছেন', result: 'পাবেন' },
  },
  cookTitle: 'রাঁধুনি যা দেখেন',
  cookBody: 'রাত দশটায় কাল কয়জনের রান্না, সেটা রাঁধুনির ফোনে পৌঁছে যায়। তাঁর কোনো অ্যাপ লাগে না।',
  cookCard: { when: 'আগামীকাল', b: 'সকাল', l: 'দুপুর', d: 'রাত' },
  settleTitle: 'মাস শেষে, মেসেঞ্জার গ্রুপে',
  settleBody: 'মাস বন্ধ করলেই কার কত দিতে বা পেতে হবে, সেই লেখা তৈরি থাকে। এক ট্যাপে গ্রুপে পাঠানো যায়।',
  settleMsg: ['অক্টোবরের হিসাব', 'মিল রেট ৳31.72', 'রহিম পাবেন ৳420', 'করিম দেবেন ৳310', 'ফাহিম দেবেন ৳110'],
  modesTitle: 'বন্ধু হোক বা অচেনা',
  modes: [
    { name: 'বন্ধুদের ফ্ল্যাট', points: ['সবার এন্ট্রি সাথে সাথে যোগ হয়', 'কাট-অফের পরের বদল দেরি হিসেবে চিহ্নিত থাকে'] },
    { name: 'অচেনাদের ফ্ল্যাট', points: ['বাজারের এন্ট্রি ম্যানেজার মিলিয়ে নেন', 'কাট-অফের পরের বদলে ম্যানেজারের অনুমতি লাগে'] },
  ],
  priceTitle: 'দাম',
  priceLine: '৳199 প্রতি মাসে, পুরো ফ্ল্যাটের জন্য',
  priceNote: 'প্রথম মাস ফ্রি। সদস্যদের কিছু দিতে হয় না।',
  faqTitle: 'প্রশ্ন',
  faq: [
    ['সদস্যদের কি অ্যাপ নামাতে হবে?', 'না। লিংক খুললেই চলে। চাইলে হোম স্ক্রিনে রেখে অ্যাপের মতো খোলা যায়।'],
    ['BashaBook কি আমাদের টাকা রাখে?', 'না। টাকা যায় ম্যানেজারের বিকাশে। BashaBook শুধু TrxID দিয়ে হিসাব রাখে।'],
    ['আইফোনে চলবে?', 'হ্যাঁ, অ্যান্ড্রয়েড আর আইফোন দুটোতেই চলে।'],
  ],
  footer: 'BashaBook · শেয়ার্ড ফ্ল্যাটের হিসাব',
};

export type Dict = typeof bn;

const en: Dict = {
  brand: 'BashaBook',
  switchLang: 'বাংলা',
  themeToggle: 'Light or dark theme',
  metaTitle: 'BashaBook · Your flat’s accounts, done for you',
  metaDesc: 'Meal counts, the cook’s headcount, bazar, bills and month-end dues, worked out for everyone in the flat.',
  heroTitle: 'Your flat’s accounts, done for you.',
  heroBody: 'Who ate how many meals, who spent what on bazar, who owes whom. BashaBook keeps the books, without the notebook or the month-end arguments.',
  create: 'Create your flat',
  joinLead: 'Already have an invite?',
  joinCta: 'Join a flat →',
  khata: {
    title: 'October ledger',
    rows: [
      ['2 Oct', 'Bazar · Rahim', '2,450'],
      ['5 Oct', 'Bazar · Karim', '1,980'],
      ['9 Oct', 'Bazar · Fahim', '2,120'],
    ],
    totalBazar: 'Total bazar',
    totalMeals: 'Total meals',
    mealRate: 'Meal rate',
    caption: 'Meal rate = total bazar ÷ total meals. In the app, every number opens to show its sum.',
    you: { who: 'Fahim · as of 9 Oct', food: 'Food (22.5 meals)', bills: 'Share of bills', paid: 'Paid', result: 'Gets back' },
  },
  cookTitle: 'What your cook sees',
  cookBody: 'At 10 pm, tomorrow’s count reaches the cook’s phone. No app needed on their side.',
  cookCard: { when: 'Tomorrow', b: 'Breakfast', l: 'Lunch', d: 'Dinner' },
  settleTitle: 'Month end, in your Messenger group',
  settleBody: 'Close the month and the who-owes-what message is ready. Send it to the group in one tap.',
  settleMsg: ['October accounts', 'Meal rate ৳31.72', 'Rahim gets ৳420', 'Karim pays ৳310', 'Fahim pays ৳110'],
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
