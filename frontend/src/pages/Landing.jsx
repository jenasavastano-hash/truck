import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CloudCog,
  Cpu,
  FileSignature,
  Fingerprint,
  Gauge,
  Layers,
  LayoutDashboard,
  Rocket,
  Scale,
  ShieldCheck,
  Truck,
  Zap,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { FEATURE_EVACUATOR_AND_COMMISSIONER } from '../config/features';
import CallbackRequestModal from '../components/landing/CallbackRequestModal';
import EntryFlowModal from '../components/landing/EntryFlowModal';
import MarketingBackdrop from '../components/landing/MarketingBackdrop';

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
};

const LANDING_PAGE_TITLE =
  'ЭПЛ и ЭТРН для грузового парка и такси — внедрение, кабинеты грузовых ЭПЛ и такси';

const LANDING_META_DESCRIPTION =
  'ЭПЛ и ЭТРН для автопарка и таксопарка: электронный путевой лист, транспортная накладная, ЭДО и Честный Знак. Внедрение под ключ; кабинеты грузовых ЭПЛ и такси — заявка на КП и вход с этой страницы.';

const heroKeywords = [
  { label: 'Грузовые ЭПЛ', hint: 'Электронный путевой лист для грузового транспорта' },
  { label: 'ЭТРН', hint: 'Электронная транспортная накладная и обмен с контрагентом' },
  { label: 'Таксопарк', hint: 'ЭПЛ и смены для такси в отдельном кабинете' },
  { label: 'ЭДО', hint: 'Приём и отправка документов через оператора' },
  { label: 'Честный Знак', hint: 'Маркировка и регламенты под проверки' },
];

const services = [
  {
    icon: FileSignature,
    coverImage: '/marketing/service-cover-epl-etrn.webp',
    coverPosition: 'center 55%',
    title: 'ЭПЛ и ЭТРН под ключ',
    text: 'Выпуск и сопровождение путевых листов и транспортных накладных под ваш парк и тип рейсов.',
    points: [
      'Такси: ЭПЛ в потоке, статусы, архив, без бумажных дублей.',
      'Груз: рейсы, маршруты, закрытие смен и комплект документов.',
      'ЭТРН: шаблоны, маршрут согласования, обмен с контрагентами.',
      'Клиника: медосмотры и фиксация допуска в контуре ЭПЛ.',
      'ЭДО: приём и отправка пакетов через оператора без ручной пересылки.',
    ],
  },
  {
    icon: BadgeCheck,
    coverImage: '/marketing/service-cover-marking.webp',
    coverPosition: 'center 50%',
    title: 'Честный Знак и маркировка',
    text: 'Регламенты под маркировку: что проверять, куда смотреть, кого уведомлять.',
    points: [
      'Статусы и события: сверка с первичкой и отгрузочными документами.',
      'Обмен: форматы площадки, контроль ошибок при выгрузке.',
      'Сроки: напоминания ответственным, чтобы не терять окна.',
      'Инструкции: короткие сценарии для смены и офиса.',
    ],
  },
  {
    icon: CloudCog,
    coverImage: '/marketing/service-cover-cabinet.webp',
    coverPosition: 'center 42%',
    title: 'Автоматизация и кабинет',
    text: 'Задачи, уведомления и исполнители в одной логике вместо таблиц и чатов.',
    points: [
      'Рутина: меньше ручных шагов в типовых операциях.',
      'Кадры: оформление, отметки, сервисные уведомления в срок.',
      'Задания: из кабинета на линию, водитель видит сразу.',
      'Уголок потребителя: QR и страница для быстрого старта.',
      'Уведомления: ответственные видят отклонения без рассылок.',
    ],
  },
];

const audiences = [
  { icon: Building2, title: 'Такси и таксопарки', text: 'ЭПЛ на линию, статусы водителей, отчётность для управляющих.' },
  { icon: Truck, title: 'Грузовые автопарки', text: 'Рейсы, ЭПЛ и ЭТРН, закрытие смены и пакет документов в одном контуре.' },
  { icon: Gauge, title: 'Логистика', text: 'Перевозки, задачи и обмен документами без разрозненных файлов.' },
  { icon: ShieldCheck, title: 'Малый бизнес', text: 'ЭДО, маркировка, кадровые и сервисные уведомления — по модулям.' },
];

const platformBlocks = [
  {
    icon: Gauge,
    title: 'Один центр управления',
    text: 'Груз: документы, рейсы и задачи в одном окне. Такси и малый бизнес — те же принципы, отдельные сценарии.',
  },
  {
    icon: Fingerprint,
    title: 'Требования под контролем',
    text: 'Честный Знак, ЭДО и внутренние регламенты — в проверяемых шагах, а не «как получится».',
  },
  {
    icon: Layers,
    title: 'Модули по необходимости',
    text: 'Подключаем ЭПЛ, ЭТРН, уведомления, отчёты и интеграции — без лишнего в тарифе.',
  },
  {
    icon: Cpu,
    title: 'Меньше ручной работы',
    text: 'Повторяющиеся действия уходят в сценарии: меньше ошибок, быстрее обработка.',
  },
];

const steps = [
  'Аудит процессов и фиксация целевого контура (что внедряем в первую очередь).',
  'Подключение ЭПЛ, ЭТРН, ЭДО и интеграций по согласованной схеме.',
  'Обучение, регламенты и вывод в ежедневную работу с сопровождением.',
];

const trustPoints = [
  'Пилот без остановки текущей работы парка',
  'Регламенты и обучение для диспетчеров и офиса',
  'Поддержка и доработки после запуска',
  'Один контакт отвечает за внедрение целиком',
];

const faqItems = [
  {
    q: 'Почему отдельно грузовые ЭПЛ и такси?',
    a: 'Грузовой контур уже в отдельной панели с полным циклом ЭПЛ. Такси — автономный продукт на своём домене; клиентский интерфейс будем сближать поэтапно. Этот сайт — презентация возможностей и вход в нужный кабинет.',
  },
  {
    q: 'Сколько занимает запуск?',
    a: 'Первый рабочий контур — ориентир 7–14 дней, зависит от объёма интеграций и числа точек подключения.',
  },
  {
    q: 'Подходит ли для небольшой компании?',
    a: 'Да. Стартуем с минимально нужного набора модулей, дальше наращиваем без смены платформы.',
  },
  {
    q: 'Можно только ЭДО или только ЭПЛ?',
    a: 'Да, модули подключаются раздельно. Архитектура рассчитана на расширение без переделки ядра.',
  },
];

const workflowScenes = [
  {
    title: 'ЭПЛ и ЭТРН в смене',
    text: 'Выпуск ЭПЛ, подписи, статус рейса и передача в ЭДО — без Excel, скринов и «кто последний в чате».',
    image: '/marketing/moscow-hero-test.png',
    imageObjectPosition: 'center 78%',
    imageAlt: 'Городской трафик и грузовой транспорт — контур ЭПЛ и ЭТРН',
  },
  {
    title: 'ЭДО под рейс',
    text: 'Шаблоны, маршрут согласования и отметки исполнения: видно узкое место и ошибку до срыва срока.',
    image: '/marketing/moscow-scene-2-edo.png',
    imageObjectPosition: 'center 63%',
    imageAlt: 'Документы и ноутбук — электронный документооборот для перевозок',
  },
  {
    title: 'Парк и логистика',
    text: 'Рейс, водитель, закрытие смены и комплект закрывающих — одна карта статусов для диспетчера и офиса.',
    image: '/marketing/moscow-scene-3-fleet.png',
    imageObjectPosition: 'center 65%',
    imageAlt: 'Грузовики на площадке — автопарк и логистика',
  },
];

/** О нас: визуальный ряд и короткие смыслы под кадрами */
const regionPhotos = [
  {
    src: '/marketing/moscow-2026-city.webp',
    alt: 'Деловой центр с высотными зданиями',
    label: 'Офис и холдинги',
    caption: 'Роли, согласования и документы — одна цепочка от службы до линии.',
  },
  {
    src: '/marketing/moscow-2026-mkad.webp',
    alt: 'Магистраль с грузовым транспортом',
    label: 'Логистика и груз',
    caption: 'ЭПЛ, ЭТРН и статусы рейсов — в одном контуре, без разрозненных файлов.',
  },
  {
    src: '/marketing/moscow-2026-street.webp',
    alt: 'Городской трафик и такси',
    label: 'Такси и город',
    caption: 'ЭПЛ в смене, диспетчеризация и регламенты — без разрыва между кабинетом и водителем.',
  },
];

const aboutPillars = [
  { icon: Building2, title: 'Таксопарки', text: 'ЭПЛ в потоке, статусы, отчёты для управления — без ручного хаоса.' },
  { icon: Truck, title: 'Логистика', text: 'Рейсы, ЭТРН, закрытие смены — шаги и сроки под контролем.' },
  { icon: ShieldCheck, title: 'Малый бизнес', text: 'ЭДО и маркировка — модулями, платите за нужный объём.' },
  { icon: Zap, title: 'Скорость', text: 'Типовые операции в сценариях — меньше ручной рутины.' },
  { icon: Scale, title: 'Закон', text: 'ЭПЛ, ЭТРН, маркировка и ЭДО — в проверяемых регламентах.' },
  { icon: LayoutDashboard, title: 'Прозрачность', text: 'Статусы и журналы: офис и линия видят одну картину.' },
];

/** Строка услуги: «поле» с подписью (до «:») и основным текстом */
function ServicePointField({ text }) {
  const colon = text.indexOf(':');
  const hasSplit = colon > 0;
  const label = hasSplit ? text.slice(0, colon).trim() : '';
  const body = hasSplit ? text.slice(colon + 1).trim() : text;
  return (
    <>
      {hasSplit ? (
        <>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-teal-800">
            {label}
          </span>
          <span className="block text-sm font-medium leading-snug text-slate-800">{body}</span>
        </>
      ) : (
        <span className="block text-sm font-medium leading-snug text-slate-800">{body}</span>
      )}
    </>
  );
}

function getRoleRoute(role) {
  if (role === 'admin') return '/admin';
  if (role === 'manager') return '/manager';
  if (role === 'director') return '/director';
  if (role === 'driver') return '/driver';
  if (role === 'evacuator') return FEATURE_EVACUATOR_AND_COMMISSIONER ? '/evacuator' : '/home';
  if (role === 'commissioner') return FEATURE_EVACUATOR_AND_COMMISSIONER ? '/commissioner' : '/home';
  return '/home';
}

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [callbackModalOpen, setCallbackModalOpen] = useState(false);
  const [entryModalOpen, setEntryModalOpen] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    navigate(getRoleRoute(user.role), { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (loading || user) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const prevTitle = document.title;
    document.title = LANDING_PAGE_TITLE;
    const metaDesc = document.querySelector('meta[name="description"]');
    const prevDesc = metaDesc?.getAttribute('content') ?? '';
    metaDesc?.setAttribute('content', LANDING_META_DESCRIPTION);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          name: 'ЭПЛ и транспортная автоматизация',
          url: origin || undefined,
          description: LANDING_META_DESCRIPTION,
        },
        {
          '@type': 'ProfessionalService',
          name: 'Внедрение ЭПЛ, ЭТРН и транспортной автоматизации',
          serviceType: 'Электронные путевые листы, ЭТРН, ЭДО, маркировка',
          description: LANDING_META_DESCRIPTION,
          url: origin || undefined,
          areaServed: { '@type': 'Country', name: 'Россия' },
        },
      ],
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-from-landing-seo', '1');
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      document.title = prevTitle;
      if (metaDesc) metaDesc.setAttribute('content', prevDesc);
      document.querySelector('script[data-from-landing-seo]')?.remove();
    };
  }, [loading, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        Загрузка...
      </div>
    );
  }

  if (user) return null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-800">
      <MarketingBackdrop />

      <main id="main-content">
      <section className="relative mx-auto flex max-w-7xl flex-col px-4 pb-14 pt-6 sm:px-6 sm:pb-16 sm:pt-8 md:pb-20 md:pt-10">
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-8 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white/90 px-3 py-3 shadow-sm shadow-slate-200/60 backdrop-blur-xl sm:mb-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4"
        >
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="rounded-xl bg-teal-50 p-2 ring-1 ring-teal-100 sm:p-2.5">
              <Rocket className="h-4 w-4 text-teal-600 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 sm:whitespace-normal">ЭПЛ и транспортная автоматизация</p>
              <p className="text-[11px] leading-snug text-slate-500 sm:text-xs">
                ЭПЛ, ЭТРН, кабинет такси, ЭДО и Честный Знак — для транспорта и учёта
              </p>
            </div>
          </div>
          <nav className="flex w-full min-w-0 items-center gap-1 overflow-x-auto pb-0.5 sm:w-auto sm:justify-end sm:gap-2 sm:pb-0 [-webkit-overflow-scrolling:touch]">
            <a
              href="#services"
              className="shrink-0 rounded-lg px-2.5 py-2 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:px-3 sm:text-sm"
            >
              Услуги
            </a>
            <a
              href="#platform"
              className="shrink-0 rounded-lg px-2.5 py-2 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:px-3 sm:text-sm"
            >
              Платформа
            </a>
            <a
              href="#about"
              className="shrink-0 rounded-lg px-2.5 py-2 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:px-3 sm:text-sm"
            >
              О нас
            </a>
            <Link
              to="/entry"
              onClick={(event) => {
                event.preventDefault();
                setEntryModalOpen(true);
              }}
              className="ml-auto shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-500 sm:ml-0 sm:px-4 sm:text-sm"
            >
              Войти
            </Link>
          </nav>
        </motion.header>

        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-10">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08 }}>
            <p className="mb-3 inline-flex items-start gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] leading-snug text-slate-600 shadow-sm sm:mb-4 sm:items-center sm:py-1.5 sm:text-xs">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 sm:mt-0" />
              <span>
                Кабинеты в работе: грузовые ЭПЛ — truckdriver.online, такси — taxidriver.space. Здесь — КП, вход и этапы
                внедрения.
              </span>
            </p>
            <h1 className="text-3xl font-extrabold leading-[1.12] text-slate-900 sm:text-4xl sm:leading-tight md:text-6xl md:leading-[1.05]">
              <span className="landing-shimmer-text">ЭПЛ и ЭТРН</span>
              <span className="text-slate-800"> для парка: </span>
              <span className="text-slate-900">груз и такси</span>
              <span className="text-slate-800"> — смена и документы под контролем</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:mt-5 sm:text-base md:text-lg md:leading-relaxed">
              Закрываем смену «под ключ»: выпуск электронного путевого листа, маршрут и статусы ЭТРН, обмен с оператором ЭДО и
              контроль регламентов. Диспетчер и офис видят одну картину — водитель не тянет бумагу и не теряет время на согласования.
              Нужен разбор под ваш парк — оставьте заявку; готовы зайти — выберите вход в кабинет ниже.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Направления продукта">
              {heroKeywords.map((chip) => (
                <li key={chip.label}>
                  <span
                    title={chip.hint}
                    className="inline-block rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm"
                  >
                    {chip.label}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col gap-2 sm:mt-7 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <Link
                to="/entry/register"
                onClick={(event) => {
                  event.preventDefault();
                  setCallbackModalOpen(true);
                }}
                className="landing-cta inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-center text-sm font-semibold text-white sm:w-auto"
              >
                Запросить внедрение
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#process"
                className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/50 sm:w-auto"
              >
                Этапы запуска
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.14 }}
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/70 sm:rounded-3xl sm:p-6"
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">
              <BadgeCheck className="h-3.5 w-3.5 text-teal-600" />
              Уже закрывает продукт
            </div>
            <div className="space-y-3">
              {workflowScenes.map((scene, idx) => (
                <motion.article
                  key={scene.title}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, delay: 0.18 + idx * 0.1 }}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm"
                >
                  <img
                    src={scene.image}
                    alt={scene.imageAlt || scene.title}
                    style={scene.imageObjectPosition ? { objectPosition: scene.imageObjectPosition } : undefined}
                    className="h-20 w-full object-cover opacity-90 transition duration-300 group-hover:scale-[1.03] sm:h-24"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/78 to-white/25" />
                  <div className="absolute inset-0 p-3">
                    <p className="text-sm font-semibold text-slate-900">{scene.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{scene.text}</p>
                  </div>
                </motion.article>
              ))}
            </div>
          </motion.div>
        </div>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="mt-10 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="mb-1 text-xl font-bold text-slate-900 md:text-2xl">Эффект после автоматизации</h2>
          <p className="mb-3 text-sm text-slate-600">Ориентиры по проектам внедрения; фактические цифры фиксируем на аудите.</p>
          <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">Меньше ручных операций</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">до 65%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">Быстрее оборот документов</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">×2,3</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">Целевой SLA доступности</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">99,9%</p>
          </div>
          </div>
        </motion.div>
      </section>

      <section id="about" aria-label="О нас" className="relative mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        <motion.div {...fadeUp} transition={{ duration: 0.45 }} className="mb-6">
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl md:text-3xl">О нас</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 md:text-base">
            Внедряем и сопровождаем цифровой контур для такси, логистики и малого бизнеса — документы, сроки и ответственные в
            одной логике.
          </p>
        </motion.div>
        <div className="grid gap-4 md:grid-cols-3">
          {regionPhotos.map((photo, idx) => (
            <motion.figure
              key={photo.src}
              {...fadeUp}
              transition={{ delay: idx * 0.06, duration: 0.45 }}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100/80"
            >
              <img
                src={photo.src}
                alt={photo.alt}
                className="aspect-[4/3] w-full object-cover transition duration-500 hover:scale-[1.02]"
                loading="lazy"
              />
              <figcaption className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/90 px-4 py-3.5">
                <span className="block text-xs font-semibold uppercase tracking-wide text-teal-800">{photo.label}</span>
                <span className="mt-1.5 block text-sm leading-snug text-slate-600">{photo.caption}</span>
              </figcaption>
            </motion.figure>
          ))}
        </div>

        <motion.div {...fadeUp} transition={{ duration: 0.45, delay: 0.06 }} className="mt-8">
          <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-slate-500">Коротко о подходе</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {aboutPillars.map((item, idx) => {
              const Icon = item.icon;
              return (
                <motion.article
                  key={item.title}
                  {...fadeUp}
                  transition={{ delay: idx * 0.04, duration: 0.35 }}
                  className="flex gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600 md:text-sm">{item.text}</p>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </motion.div>
      </section>

      <section id="services" className="relative mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        <img
          src="/marketing/services-section-mesh.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 z-0 h-48 w-[min(100%,56rem)] -translate-x-1/2 select-none object-cover object-top opacity-[0.18]"
        />
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.45 }}
          className="relative z-[1] mb-4 text-xl font-bold text-slate-900 sm:mb-5 sm:text-2xl md:text-3xl"
        >
          Что входит во внедрение
        </motion.h2>
        <p className="relative z-[1] mb-5 max-w-3xl text-xs leading-relaxed text-slate-600 sm:text-sm md:text-base">
          В основе внедрения — грузовые ЭПЛ и связанный документооборот (в том числе ЭТРН). Такси и сценарии для малого бизнеса
          (ЭДО, маркировка) подключаются отдельными модулями, если они нужны по задаче.
        </p>
        <div className="relative z-[1] grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {services.map((item, idx) => {
            const ServiceIcon = item.icon;
            return (
              <motion.article
                key={item.title}
                {...fadeUp}
                transition={{ delay: idx * 0.06, duration: 0.45 }}
                initial="rest"
                animate="rest"
                whileHover="hover"
                variants={{
                  rest: { y: 0 },
                  hover: { y: -6 },
                }}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-teal-300 hover:shadow-md"
              >
                <div className="relative aspect-[2.1/1] min-h-[7.5rem] w-full shrink-0 overflow-hidden sm:aspect-[2.2/1] sm:min-h-[8.5rem]">
                  <img
                    src={item.coverImage}
                    alt=""
                    style={item.coverPosition ? { objectPosition: item.coverPosition } : undefined}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                    loading="lazy"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/45 via-slate-900/10 to-transparent" />
                </div>
                <div className="flex flex-1 flex-col p-4 sm:p-5">
                  <div className="mb-3 flex min-h-[3rem] items-center gap-2.5 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 via-cyan-50/70 to-teal-50/90 px-2.5 py-2 shadow-sm transition group-hover:border-teal-300 sm:gap-3 sm:px-3 sm:py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm ring-2 ring-teal-100 sm:h-9 sm:w-9">
                      <ServiceIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                    </span>
                    <h3 className="text-sm font-bold leading-snug text-teal-950 sm:text-base md:text-lg">{item.title}</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600 sm:text-sm">{item.text}</p>
                  <motion.ul
                    className="mt-3 space-y-2 sm:mt-4"
                    variants={{
                      rest: { transition: { staggerChildren: 0.01, staggerDirection: -1 } },
                      hover: { transition: { staggerChildren: 0.05 } },
                    }}
                  >
                    {item.points.map((point) => (
                      <motion.li
                        key={point}
                        variants={{
                          rest: { x: 0, opacity: 1 },
                          hover: { x: 4, opacity: 1 },
                        }}
                        className="min-h-[2.85rem] rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition-colors group-hover:border-teal-200 group-hover:bg-teal-50/50 sm:min-h-[3.1rem] sm:px-3 sm:py-2.5"
                      >
                        <ServicePointField text={point} />
                      </motion.li>
                    ))}
                  </motion.ul>
                </div>
              </motion.article>
            );
          })}
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.45 }}
          className="mb-4 text-xl font-bold text-slate-900 sm:text-2xl md:text-3xl"
        >
          Кому подходит
        </motion.h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audiences.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.title}
                {...fadeUp}
                transition={{ delay: idx * 0.07, duration: 0.45 }}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <Icon className="mb-3 h-6 w-6 text-teal-600" />
                <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{item.text}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section id="platform" className="relative mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.45 }}
          className="mb-5 text-xl font-bold text-slate-900 sm:text-2xl md:text-3xl"
        >
          Как устроена платформа
        </motion.h2>
        <div className="grid gap-4 md:grid-cols-2">
          {platformBlocks.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.article
                key={item.title}
                {...fadeUp}
                transition={{ delay: idx * 0.06, duration: 0.45 }}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <Icon className="mb-3 h-6 w-6 text-teal-600" />
                <h3 className="text-base font-semibold text-slate-900 sm:text-lg">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{item.text}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      <section id="process" className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6 md:p-8">
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl md:text-3xl">Как запускаем внедрение</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {steps.map((step, idx) => (
              <motion.div
                key={step}
                {...fadeUp}
                transition={{ delay: idx * 0.08, duration: 0.45 }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700"
              >
                <p className="mb-2 text-xs font-semibold text-teal-700">Шаг {idx + 1}</p>
                {step}
              </motion.div>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-teal-200 bg-teal-50/80 p-4 sm:mt-7 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-teal-900 sm:text-sm">
              Один созвон — понятный план по грузовым ЭПЛ, такси и ЭДО: этапы, сроки, ответственные.
            </p>
            <Link
              to="/entry/register"
              onClick={(event) => {
                event.preventDefault();
                setCallbackModalOpen(true);
              }}
              className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-500 sm:w-auto"
            >
              Обсудить запуск
            </Link>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
        <div className="grid gap-4 md:grid-cols-2">
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.45 }}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <h3 className="text-lg font-bold text-slate-900 sm:text-xl">Почему выбирают нас</h3>
            <div className="mt-4 space-y-2">
              {trustPoints.map((point) => (
                <div key={point} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-600" />
                  <span>{point}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <h3 className="text-lg font-bold text-slate-900 sm:text-xl">Частые вопросы</h3>
            <div className="mt-4 space-y-2">
              {faqItems.map((item) => (
                <details key={item.q} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">{item.q}</summary>
                  <p className="mt-2 text-sm text-slate-600">{item.a}</p>
                </details>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.45 }}
          className="rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-slate-50 p-6 shadow-sm md:p-8"
        >
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">Коммерческое предложение за одну заявку</h2>
          <p className="mt-3 max-w-3xl text-sm text-slate-600 md:text-base">
            Оставьте контакты: вернёмся с КП — этапы по грузовым ЭПЛ, связка с такси, ЭДО и маркировка, сроки старта и зона
            ответственности с нашей стороны.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            <Link
              to="/entry/register"
              onClick={(event) => {
                event.preventDefault();
                setCallbackModalOpen(true);
              }}
              className="landing-cta inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white sm:w-auto"
            >
              Получить КП
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/entry/login"
              onClick={(event) => {
                event.preventDefault();
                setEntryModalOpen(true);
              }}
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/40 sm:w-auto"
            >
              Вход в кабинет
            </Link>
          </div>
        </motion.div>
      </section>

      </main>

      <footer className="relative border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <p>© {new Date().getFullYear()} ЭПЛ, ЭТРН, ЭДО. Транспорт и маркировка.</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">Грузовые ЭПЛ</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">Такси</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">ЭТРН</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">ЭДО</span>
          </div>
        </div>
      </footer>
      <CallbackRequestModal
        isOpen={callbackModalOpen}
        onClose={() => setCallbackModalOpen(false)}
        source="landing-cta"
      />
      <EntryFlowModal
        isOpen={entryModalOpen}
        onClose={() => setEntryModalOpen(false)}
      />
    </div>
  );
}
