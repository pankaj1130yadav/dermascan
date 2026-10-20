// Minimal i18n: LanguageProvider with 'en' / 'hi', persisted in localStorage.
// Scope (honest): nav + main UI chrome + primary headings/buttons of Landing,
// Analyze, History, Dashboard, Gallery and ABCDE. Longer educational
// paragraphs intentionally stay in English.
import { createContext, useContext, useEffect, useState } from 'react';

const DICT = {
  en: {
    home: 'Home', analyze: 'Analyze', history: 'History', dashboard: 'Dashboard',
    model: 'Model', learn: 'Learn', gallery: 'Gallery', abcde: 'ABCDE',
    bodymap: 'Body Map', consult: 'Consult', profiles: 'Profiles', admin: 'Admin',
    login: 'Log in', signup: 'Sign up', logout: 'Log out', more: 'More',
    upload: 'Upload', results: 'Results', disclaimer_short: 'Educational demo — not a medical device. Model predictions are experimental.',
    analyze_title: 'Analyze a lesion', analyze_lede: 'Upload a clear photograph of a skin lesion. The model will return its three most likely categories with probabilities — treat the output as an educational signal, nothing more.',
    analyze_btn: 'Analyze', analyzing: 'Analyzing…', choose_another: 'Choose another image',
    upload_headline: 'Drop an image here, or click to browse', upload_hint: 'JPG, PNG or WebP — a sharp, well-lit close-up works best.',
    model_findings: 'Model findings',
    history_title: 'Analysis history', history_lede: 'Every analysis you run is saved here, so you can watch how the spots you are tracking change over time.',
    no_analyses: 'No analyses yet', delete: 'Delete',
    dashboard_title: 'Your dashboard', dashboard_lede: 'A summary of your analyses, feedback and follow-up reminders.',
    gallery_title: 'Sample gallery', gallery_lede: 'Real sample images from the HAM10000 dataset with their dataset labels.',
    abcde_title: 'ABCDE self-assessment', abcde_lede: 'A guided checklist for looking at a mole. This is NOT a diagnosis.',
    landing_eyebrow: 'An educational project in early detection',
    landing_title_1: 'Your skin keeps a journal.', landing_title_2: 'Learn to read it early.',
    landing_sub: 'DermaScan is a learning demo that studies photographs of skin lesions with a fine-tuned neural network. It exists to build awareness — noticing change sooner, and knowing when a dermatologist should take the next look.',
    how_it_works: 'How it works', total_analyses: 'Total analyses', high_risk: 'High-risk signals',
    feedback_accuracy: 'Feedback accuracy', insights: 'Insights', reminders: 'Follow-up reminders',
    uv_today: "Today's UV index", loading: 'Loading…', submit: 'Submit', cancel: 'Cancel',
    download_pdf: 'Download PDF', share: 'Share', email_report: 'Email report',
    looks_right: 'Looks right', looks_wrong: 'Looks wrong', thanks_feedback: 'Thanks for your feedback.',
  },
  hi: {
    home: 'होम', analyze: 'जांच करें', history: 'इतिहास', dashboard: 'डैशबोर्ड',
    model: 'मॉडल', learn: 'सीखें', gallery: 'गैलरी', abcde: 'ABCDE',
    bodymap: 'बॉडी मैप', consult: 'परामर्श', profiles: 'प्रोफ़ाइल', admin: 'एडमिन',
    login: 'लॉग इन', signup: 'साइन अप', logout: 'लॉग आउट', more: 'और',
    upload: 'अपलोड', results: 'परिणाम', disclaimer_short: 'शैक्षणिक डेमो — यह कोई चिकित्सा उपकरण नहीं है। मॉडल की भविष्यवाणियाँ प्रायोगिक हैं।',
    analyze_title: 'त्वचा के निशान की जांच करें', analyze_lede: 'त्वचा के निशान की साफ़ तस्वीर अपलोड करें। मॉडल तीन सबसे संभावित श्रेणियाँ संभावना के साथ दिखाएगा — इसे केवल शैक्षणिक संकेत समझें, इससे ज़्यादा नहीं।',
    analyze_btn: 'जांच करें', analyzing: 'जांच हो रही है…', choose_another: 'दूसरी तस्वीर चुनें',
    upload_headline: 'तस्वीर यहाँ डालें, या चुनने के लिए क्लिक करें', upload_hint: 'JPG, PNG या WebP — तेज़ रोशनी वाली साफ़ क्लोज़-अप तस्वीर सबसे अच्छी रहती है।',
    model_findings: 'मॉडल के परिणाम',
    history_title: 'जांच का इतिहास', history_lede: 'आपकी हर जांच यहाँ सहेजी जाती है, ताकि आप समय के साथ निशानों में बदलाव देख सकें।',
    no_analyses: 'अभी कोई जांच नहीं', delete: 'हटाएँ',
    dashboard_title: 'आपका डैशबोर्ड', dashboard_lede: 'आपकी जांचों, फ़ीडबैक और फ़ॉलो-अप रिमाइंडर का सारांश।',
    gallery_title: 'नमूना गैलरी', gallery_lede: 'HAM10000 डेटासेट की असली नमूना तस्वीरें, उनके डेटासेट लेबल के साथ।',
    abcde_title: 'ABCDE स्व-मूल्यांकन', abcde_lede: 'तिल को देखने के लिए एक मार्गदर्शित चेकलिस्ट। यह निदान (डायग्नोसिस) नहीं है।',
    landing_eyebrow: 'जल्दी पहचान पर एक शैक्षणिक परियोजना',
    landing_title_1: 'आपकी त्वचा एक डायरी रखती है।', landing_title_2: 'इसे जल्दी पढ़ना सीखें।',
    landing_sub: 'DermaScan एक शैक्षणिक डेमो है जो त्वचा के निशानों की तस्वीरों का अध्ययन एक प्रशिक्षित न्यूरल नेटवर्क से करता है। इसका उद्देश्य जागरूकता है — बदलाव को जल्दी पहचानना, और यह जानना कि त्वचा विशेषज्ञ को कब दिखाना चाहिए।',
    how_it_works: 'यह कैसे काम करता है', total_analyses: 'कुल जांचें', high_risk: 'उच्च-जोखिम संकेत',
    feedback_accuracy: 'फ़ीडबैक सटीकता', insights: 'जानकारी', reminders: 'फ़ॉलो-अप रिमाइंडर',
    uv_today: 'आज का UV इंडेक्स', loading: 'लोड हो रहा है…', submit: 'जमा करें', cancel: 'रद्द करें',
    download_pdf: 'PDF डाउनलोड करें', share: 'साझा करें', email_report: 'रिपोर्ट ईमेल करें',
    looks_right: 'सही लगता है', looks_wrong: 'गलत लगता है', thanks_feedback: 'आपके फ़ीडबैक के लिए धन्यवाद।',
  },
};

const LangContext = createContext({ lang: 'en', setLang: () => {}, t: (k) => k });

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('dermascan_lang') || 'en');
  useEffect(() => { localStorage.setItem('dermascan_lang', lang); }, [lang]);
  const t = (key) => DICT[lang]?.[key] || DICT.en[key] || key;
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() { return useContext(LangContext); }
