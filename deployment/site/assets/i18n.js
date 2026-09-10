(() => {
  const locales = [
    ['tr', 'Türkçe', 'ltr'], ['en', 'English', 'ltr'], ['de', 'Deutsch', 'ltr'], ['fr', 'Français', 'ltr'],
    ['es', 'Español', 'ltr'], ['pt-BR', 'Português (Brasil)', 'ltr'], ['it', 'Italiano', 'ltr'], ['ru', 'Русский', 'ltr'],
    ['ar', 'العربية', 'rtl'], ['ja', '日本語', 'ltr'], ['ko', '한국어', 'ltr'], ['zh-CN', '简体中文', 'ltr'],
  ];
  const supported = new Set(locales.map(([code]) => code));
  const storageKey = 'tahosapp:site-locale';
  const explicitKey = 'tahosapp:site-locale:explicit';
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();

  const core = {
    tr: {
      'v1.2.0 · Windows 10/11 · 64-bit · Web version · Independent and free': 'v1.2.0 · Windows 10/11 · 64-bit · Web sürümü · Bağımsız ve ücretsiz',
      'Multilingual app and website with 12 languages, automatic locale detection, server-wide notification controls, and a context-aware notification center.': '12 dil, otomatik dil algılama, sunucu geneli bildirim kontrolleri ve yalnızca ilgili ekranlarda görünen bildirim merkeziyle çok dilli uygulama ve web sitesi.',
      'Download 1.2.0': "1.2.0'ı indir",
      'Added 12 selectable interface languages to the app and website.': 'Uygulama ve web sitesine seçilebilir 12 arayüz dili eklendi.',
      'Added automatic language detection from browser and regional settings while preserving manual choices.': 'Kullanıcının seçimini koruyan tarayıcı ve bölge ayarı tabanlı otomatik dil algılama eklendi.',
      'Made Turkish the default for new accounts and migrated the earlier forced-English preference safely.': 'Yeni hesaplarda Türkçe varsayılan yapıldı ve önceki zorunlu İngilizce tercihi güvenle düzeltildi.',
      'Added complete per-server notification controls directly to the server menu for every member.': 'Her üyenin sunucu menüsünden erişebildiği eksiksiz sunucu bildirim kontrolleri eklendi.',
      'Made the notification center contextual so it no longer floats over unrelated screens.': 'Bildirim merkezi yalnızca ilgili ekranlarda görünecek şekilde düzenlendi.',
      'Added translation and version-policy checks to keep future releases consistent.': 'Gelecek sürümlerde tutarlılık için çeviri ve sürüm politikası kontrolleri eklendi.',
    },
    de: {
      Features: 'Funktionen', Security: 'Sicherheit', About: 'Über uns', Status: 'Status', 'Log in': 'Anmelden', 'Skip to content': 'Zum Inhalt springen', 'Download for Windows': 'Für Windows herunterladen', 'Use in your browser': 'Im Browser verwenden', 'View all features →': 'Alle Funktionen ansehen →', 'Connect · Talk · Share': 'Verbinden · Reden · Teilen', 'One place for': 'Ein Ort für', 'your community.': 'deine Community.', 'Real-time connection': 'Echtzeitverbindung', 'Voice connection ready': 'Sprachverbindung bereit', 'Product preview': 'Produktvorschau', 'Web + desktop': 'Web + Desktop', 'Detailed permissions': 'Detaillierte Berechtigungen', 'No paid tier': 'Keine Bezahlschranke', 'App themes': 'App-Designs', 'Profile themes': 'Profildesigns', 'Name appearance': 'Namensdarstellung', 'Avatar decorations': 'Avatar-Dekorationen', 'High-quality streaming': 'Hochwertiges Streaming', 'Community content': 'Community-Inhalte', 'Open source and transparent development': 'Open Source und transparente Entwicklung', 'Open GitHub repository ↗': 'GitHub-Repository öffnen ↗', 'View releases': 'Versionen ansehen', 'Every form of communication': 'Jede Art der Kommunikation', 'Real-time messaging': 'Echtzeitnachrichten', 'Voice chat': 'Sprachchat', 'Video and streaming': 'Video und Streaming', 'Server and channel management': 'Server- und Kanalverwaltung', 'Roles and moderation': 'Rollen und Moderation', Notifications: 'Benachrichtigungen', 'Current desktop release': 'Aktuelle Desktop-Version', 'Release notes →': 'Versionshinweise →', 'Service status': 'Dienststatus', 'Frequently asked questions': 'Häufig gestellte Fragen', Product: 'Produkt', Rules: 'Regeln', Privacy: 'Datenschutz', Contact: 'Kontakt', 'Terms of Use': 'Nutzungsbedingungen', 'Community Guidelines': 'Community-Richtlinien', 'Web application': 'Webanwendung',
    },
    fr: {
      Features: 'Fonctionnalités', Security: 'Sécurité', About: 'À propos', Status: 'État', 'Log in': 'Se connecter', 'Skip to content': 'Aller au contenu', 'Download for Windows': 'Télécharger pour Windows', 'Use in your browser': 'Utiliser dans le navigateur', 'View all features →': 'Voir toutes les fonctionnalités →', 'Connect · Talk · Share': 'Connectez · Parlez · Partagez', 'One place for': 'Un seul endroit pour', 'your community.': 'votre communauté.', 'Real-time connection': 'Connexion en temps réel', 'Voice connection ready': 'Connexion vocale prête', 'Product preview': 'Aperçu du produit', 'Web + desktop': 'Web + bureau', 'Detailed permissions': 'Autorisations détaillées', 'No paid tier': 'Aucune option payante', 'App themes': 'Thèmes de l’application', 'Profile themes': 'Thèmes de profil', 'Name appearance': 'Apparence du nom', 'Avatar decorations': 'Décorations d’avatar', 'High-quality streaming': 'Diffusion haute qualité', 'Community content': 'Contenu communautaire', 'Open source and transparent development': 'Open source et développement transparent', 'Open GitHub repository ↗': 'Ouvrir le dépôt GitHub ↗', 'View releases': 'Voir les versions', 'Every form of communication': 'Toutes les formes de communication', 'Real-time messaging': 'Messagerie en temps réel', 'Voice chat': 'Discussion vocale', 'Video and streaming': 'Vidéo et diffusion', 'Server and channel management': 'Gestion des serveurs et salons', 'Roles and moderation': 'Rôles et modération', Notifications: 'Notifications', 'Current desktop release': 'Version de bureau actuelle', 'Release notes →': 'Notes de version →', 'Service status': 'État du service', 'Frequently asked questions': 'Questions fréquentes', Product: 'Produit', Rules: 'Règles', Privacy: 'Confidentialité', Contact: 'Contact', 'Terms of Use': 'Conditions d’utilisation', 'Community Guidelines': 'Règles de la communauté', 'Web application': 'Application web',
    },
    es: {
      Features: 'Funciones', Security: 'Seguridad', About: 'Acerca de', Status: 'Estado', 'Log in': 'Iniciar sesión', 'Skip to content': 'Ir al contenido', 'Download for Windows': 'Descargar para Windows', 'Use in your browser': 'Usar en el navegador', 'View all features →': 'Ver todas las funciones →', 'Connect · Talk · Share': 'Conecta · Habla · Comparte', 'One place for': 'Un lugar para', 'your community.': 'tu comunidad.', 'Real-time connection': 'Conexión en tiempo real', 'Voice connection ready': 'Conexión de voz lista', 'Product preview': 'Vista previa del producto', 'Web + desktop': 'Web + escritorio', 'Detailed permissions': 'Permisos detallados', 'No paid tier': 'Sin nivel de pago', 'App themes': 'Temas de la aplicación', 'Profile themes': 'Temas de perfil', 'Name appearance': 'Apariencia del nombre', 'Avatar decorations': 'Decoraciones de avatar', 'High-quality streaming': 'Transmisión de alta calidad', 'Community content': 'Contenido de la comunidad', 'Open source and transparent development': 'Código abierto y desarrollo transparente', 'Open GitHub repository ↗': 'Abrir repositorio de GitHub ↗', 'View releases': 'Ver versiones', 'Every form of communication': 'Todas las formas de comunicación', 'Real-time messaging': 'Mensajería en tiempo real', 'Voice chat': 'Chat de voz', 'Video and streaming': 'Vídeo y transmisión', 'Server and channel management': 'Gestión de servidores y canales', 'Roles and moderation': 'Roles y moderación', Notifications: 'Notificaciones', 'Current desktop release': 'Versión de escritorio actual', 'Release notes →': 'Notas de la versión →', 'Service status': 'Estado del servicio', 'Frequently asked questions': 'Preguntas frecuentes', Product: 'Producto', Rules: 'Reglas', Privacy: 'Privacidad', Contact: 'Contacto', 'Terms of Use': 'Términos de uso', 'Community Guidelines': 'Normas de la comunidad', 'Web application': 'Aplicación web',
    },
    'pt-BR': {
      Features: 'Recursos', Security: 'Segurança', About: 'Sobre', Status: 'Status', 'Log in': 'Entrar', 'Skip to content': 'Ir para o conteúdo', 'Download for Windows': 'Baixar para Windows', 'Use in your browser': 'Usar no navegador', 'View all features →': 'Ver todos os recursos →', 'Connect · Talk · Share': 'Conecte · Converse · Compartilhe', 'One place for': 'Um lugar para', 'your community.': 'sua comunidade.', 'Real-time connection': 'Conexão em tempo real', 'Voice connection ready': 'Conexão de voz pronta', 'Product preview': 'Prévia do produto', 'Web + desktop': 'Web + desktop', 'Detailed permissions': 'Permissões detalhadas', 'No paid tier': 'Sem plano pago', 'App themes': 'Temas do aplicativo', 'Profile themes': 'Temas de perfil', 'Name appearance': 'Aparência do nome', 'Avatar decorations': 'Decorações de avatar', 'High-quality streaming': 'Transmissão de alta qualidade', 'Community content': 'Conteúdo da comunidade', 'Open source and transparent development': 'Código aberto e desenvolvimento transparente', 'Open GitHub repository ↗': 'Abrir repositório no GitHub ↗', 'View releases': 'Ver versões', 'Every form of communication': 'Todas as formas de comunicação', 'Real-time messaging': 'Mensagens em tempo real', 'Voice chat': 'Chat de voz', 'Video and streaming': 'Vídeo e transmissão', 'Server and channel management': 'Gerenciamento de servidores e canais', 'Roles and moderation': 'Cargos e moderação', Notifications: 'Notificações', 'Current desktop release': 'Versão atual para desktop', 'Release notes →': 'Notas da versão →', 'Service status': 'Status do serviço', 'Frequently asked questions': 'Perguntas frequentes', Product: 'Produto', Rules: 'Regras', Privacy: 'Privacidade', Contact: 'Contato', 'Terms of Use': 'Termos de uso', 'Community Guidelines': 'Diretrizes da comunidade', 'Web application': 'Aplicativo web',
    },
    it: {
      Features: 'Funzionalità', Security: 'Sicurezza', About: 'Informazioni', Status: 'Stato', 'Log in': 'Accedi', 'Skip to content': 'Vai al contenuto', 'Download for Windows': 'Scarica per Windows', 'Use in your browser': 'Usa nel browser', 'View all features →': 'Vedi tutte le funzionalità →', 'Connect · Talk · Share': 'Connettiti · Parla · Condividi', 'One place for': 'Un posto per', 'your community.': 'la tua comunità.', 'Real-time connection': 'Connessione in tempo reale', 'Voice connection ready': 'Connessione vocale pronta', 'Product preview': 'Anteprima del prodotto', 'Web + desktop': 'Web + desktop', 'Detailed permissions': 'Permessi dettagliati', 'No paid tier': 'Nessun piano a pagamento', 'App themes': 'Temi dell’app', 'Profile themes': 'Temi del profilo', 'Name appearance': 'Aspetto del nome', 'Avatar decorations': 'Decorazioni avatar', 'High-quality streaming': 'Streaming di alta qualità', 'Community content': 'Contenuti della comunità', 'Open source and transparent development': 'Open source e sviluppo trasparente', 'Open GitHub repository ↗': 'Apri repository GitHub ↗', 'View releases': 'Vedi versioni', 'Every form of communication': 'Ogni forma di comunicazione', 'Real-time messaging': 'Messaggistica in tempo reale', 'Voice chat': 'Chat vocale', 'Video and streaming': 'Video e streaming', 'Server and channel management': 'Gestione di server e canali', 'Roles and moderation': 'Ruoli e moderazione', Notifications: 'Notifiche', 'Current desktop release': 'Versione desktop attuale', 'Release notes →': 'Note di rilascio →', 'Service status': 'Stato del servizio', 'Frequently asked questions': 'Domande frequenti', Product: 'Prodotto', Rules: 'Regole', Privacy: 'Privacy', Contact: 'Contatti', 'Terms of Use': 'Termini di utilizzo', 'Community Guidelines': 'Linee guida della comunità', 'Web application': 'Applicazione web',
    },
    ru: {
      Features: 'Возможности', Security: 'Безопасность', About: 'О проекте', Status: 'Статус', 'Log in': 'Войти', 'Skip to content': 'Перейти к содержанию', 'Download for Windows': 'Скачать для Windows', 'Use in your browser': 'Открыть в браузере', 'View all features →': 'Все возможности →', 'Connect · Talk · Share': 'Общайтесь · Говорите · Делитесь', 'One place for': 'Одно место для', 'your community.': 'вашего сообщества.', 'Real-time connection': 'Соединение в реальном времени', 'Voice connection ready': 'Голосовая связь готова', 'Product preview': 'Обзор продукта', 'Web + desktop': 'Веб + компьютер', 'Detailed permissions': 'Подробные разрешения', 'No paid tier': 'Без платного уровня', 'App themes': 'Темы приложения', 'Profile themes': 'Темы профиля', 'Name appearance': 'Оформление имени', 'Avatar decorations': 'Украшения аватара', 'High-quality streaming': 'Высококачественная трансляция', 'Community content': 'Контент сообщества', 'Open source and transparent development': 'Открытый код и прозрачная разработка', 'Open GitHub repository ↗': 'Открыть репозиторий GitHub ↗', 'View releases': 'Посмотреть версии', 'Every form of communication': 'Все способы общения', 'Real-time messaging': 'Сообщения в реальном времени', 'Voice chat': 'Голосовой чат', 'Video and streaming': 'Видео и трансляции', 'Server and channel management': 'Управление серверами и каналами', 'Roles and moderation': 'Роли и модерация', Notifications: 'Уведомления', 'Current desktop release': 'Текущая версия для компьютера', 'Release notes →': 'Примечания к выпуску →', 'Service status': 'Статус сервиса', 'Frequently asked questions': 'Частые вопросы', Product: 'Продукт', Rules: 'Правила', Privacy: 'Конфиденциальность', Contact: 'Контакты', 'Terms of Use': 'Условия использования', 'Community Guidelines': 'Правила сообщества', 'Web application': 'Веб-приложение',
    },
    ar: {
      Features: 'الميزات', Security: 'الأمان', About: 'حول', Status: 'الحالة', 'Log in': 'تسجيل الدخول', 'Skip to content': 'انتقل إلى المحتوى', 'Download for Windows': 'تنزيل لنظام Windows', 'Use in your browser': 'استخدام في المتصفح', 'View all features →': 'عرض جميع الميزات ←', 'Connect · Talk · Share': 'تواصل · تحدث · شارك', 'One place for': 'مكان واحد من أجل', 'your community.': 'مجتمعك.', 'Real-time connection': 'اتصال فوري', 'Voice connection ready': 'الاتصال الصوتي جاهز', 'Product preview': 'معاينة المنتج', 'Web + desktop': 'الويب + سطح المكتب', 'Detailed permissions': 'أذونات تفصيلية', 'No paid tier': 'لا توجد فئة مدفوعة', 'App themes': 'سمات التطبيق', 'Profile themes': 'سمات الملف الشخصي', 'Name appearance': 'مظهر الاسم', 'Avatar decorations': 'زخارف الصورة الرمزية', 'High-quality streaming': 'بث عالي الجودة', 'Community content': 'محتوى المجتمع', 'Open source and transparent development': 'مفتوح المصدر وتطوير شفاف', 'Open GitHub repository ↗': 'فتح مستودع GitHub ↗', 'View releases': 'عرض الإصدارات', 'Every form of communication': 'كل أشكال التواصل', 'Real-time messaging': 'مراسلة فورية', 'Voice chat': 'دردشة صوتية', 'Video and streaming': 'فيديو وبث', 'Server and channel management': 'إدارة الخوادم والقنوات', 'Roles and moderation': 'الأدوار والإشراف', Notifications: 'الإشعارات', 'Current desktop release': 'إصدار سطح المكتب الحالي', 'Release notes →': 'ملاحظات الإصدار ←', 'Service status': 'حالة الخدمة', 'Frequently asked questions': 'الأسئلة الشائعة', Product: 'المنتج', Rules: 'القواعد', Privacy: 'الخصوصية', Contact: 'الاتصال', 'Terms of Use': 'شروط الاستخدام', 'Community Guidelines': 'إرشادات المجتمع', 'Web application': 'تطبيق الويب',
    },
    ja: {
      Features: '機能', Security: 'セキュリティ', About: '概要', Status: 'ステータス', 'Log in': 'ログイン', 'Skip to content': 'コンテンツへ移動', 'Download for Windows': 'Windows 版をダウンロード', 'Use in your browser': 'ブラウザーで使用', 'View all features →': 'すべての機能を見る →', 'Connect · Talk · Share': 'つながる · 話す · 共有する', 'One place for': 'ひとつの場所に', 'your community.': 'あなたのコミュニティを。', 'Real-time connection': 'リアルタイム接続', 'Voice connection ready': '音声接続の準備完了', 'Product preview': '製品プレビュー', 'Web + desktop': 'Web + デスクトップ', 'Detailed permissions': '詳細な権限', 'No paid tier': '有料プランなし', 'App themes': 'アプリテーマ', 'Profile themes': 'プロフィールテーマ', 'Name appearance': '名前の表示', 'Avatar decorations': 'アバター装飾', 'High-quality streaming': '高品質配信', 'Community content': 'コミュニティコンテンツ', 'Open source and transparent development': 'オープンソースで透明な開発', 'Open GitHub repository ↗': 'GitHub リポジトリを開く ↗', 'View releases': 'リリースを見る', 'Every form of communication': 'あらゆるコミュニケーション', 'Real-time messaging': 'リアルタイムメッセージ', 'Voice chat': 'ボイスチャット', 'Video and streaming': 'ビデオと配信', 'Server and channel management': 'サーバーとチャンネルの管理', 'Roles and moderation': 'ロールとモデレーション', Notifications: '通知', 'Current desktop release': '最新デスクトップ版', 'Release notes →': 'リリースノート →', 'Service status': 'サービス状況', 'Frequently asked questions': 'よくある質問', Product: '製品', Rules: 'ルール', Privacy: 'プライバシー', Contact: 'お問い合わせ', 'Terms of Use': '利用規約', 'Community Guidelines': 'コミュニティガイドライン', 'Web application': 'Web アプリ',
    },
    ko: {
      Features: '기능', Security: '보안', About: '소개', Status: '상태', 'Log in': '로그인', 'Skip to content': '콘텐츠로 이동', 'Download for Windows': 'Windows용 다운로드', 'Use in your browser': '브라우저에서 사용', 'View all features →': '모든 기능 보기 →', 'Connect · Talk · Share': '연결 · 대화 · 공유', 'One place for': '하나의 공간에', 'your community.': '당신의 커뮤니티를.', 'Real-time connection': '실시간 연결', 'Voice connection ready': '음성 연결 준비됨', 'Product preview': '제품 미리보기', 'Web + desktop': '웹 + 데스크톱', 'Detailed permissions': '세부 권한', 'No paid tier': '유료 등급 없음', 'App themes': '앱 테마', 'Profile themes': '프로필 테마', 'Name appearance': '이름 꾸미기', 'Avatar decorations': '아바타 장식', 'High-quality streaming': '고화질 스트리밍', 'Community content': '커뮤니티 콘텐츠', 'Open source and transparent development': '오픈 소스와 투명한 개발', 'Open GitHub repository ↗': 'GitHub 저장소 열기 ↗', 'View releases': '릴리스 보기', 'Every form of communication': '모든 형태의 소통', 'Real-time messaging': '실시간 메시지', 'Voice chat': '음성 채팅', 'Video and streaming': '비디오 및 스트리밍', 'Server and channel management': '서버 및 채널 관리', 'Roles and moderation': '역할 및 관리', Notifications: '알림', 'Current desktop release': '현재 데스크톱 릴리스', 'Release notes →': '릴리스 노트 →', 'Service status': '서비스 상태', 'Frequently asked questions': '자주 묻는 질문', Product: '제품', Rules: '규칙', Privacy: '개인정보', Contact: '연락처', 'Terms of Use': '이용 약관', 'Community Guidelines': '커뮤니티 가이드라인', 'Web application': '웹 앱',
    },
    'zh-CN': {
      Features: '功能', Security: '安全', About: '关于', Status: '状态', 'Log in': '登录', 'Skip to content': '跳到内容', 'Download for Windows': '下载 Windows 版', 'Use in your browser': '在浏览器中使用', 'View all features →': '查看所有功能 →', 'Connect · Talk · Share': '连接 · 交流 · 分享', 'One place for': '一个空间，属于', 'your community.': '你的社区。', 'Real-time connection': '实时连接', 'Voice connection ready': '语音连接已就绪', 'Product preview': '产品预览', 'Web + desktop': '网页 + 桌面', 'Detailed permissions': '详细权限', 'No paid tier': '无付费等级', 'App themes': '应用主题', 'Profile themes': '个人资料主题', 'Name appearance': '名称外观', 'Avatar decorations': '头像装饰', 'High-quality streaming': '高质量直播', 'Community content': '社区内容', 'Open source and transparent development': '开源且透明的开发', 'Open GitHub repository ↗': '打开 GitHub 仓库 ↗', 'View releases': '查看版本', 'Every form of communication': '各种沟通方式', 'Real-time messaging': '实时消息', 'Voice chat': '语音聊天', 'Video and streaming': '视频与直播', 'Server and channel management': '服务器和频道管理', 'Roles and moderation': '身份组与管理', Notifications: '通知', 'Current desktop release': '当前桌面版本', 'Release notes →': '发行说明 →', 'Service status': '服务状态', 'Frequently asked questions': '常见问题', Product: '产品', Rules: '规则', Privacy: '隐私', Contact: '联系', 'Terms of Use': '使用条款', 'Community Guidelines': '社区准则', 'Web application': '网页应用',
    },
  };

  function normalize(value) {
    const candidate = String(value || '').trim();
    if (supported.has(candidate)) return candidate;
    const lower = candidate.toLowerCase();
    if (lower.startsWith('pt')) return 'pt-BR';
    if (lower.startsWith('zh')) return 'zh-CN';
    return locales.find(([code]) => code.toLowerCase() === lower.split('-')[0])?.[0] || null;
  }

  function detect() {
    if (localStorage.getItem(explicitKey) === '1') {
      const stored = normalize(localStorage.getItem(storageKey));
      if (stored) return stored;
    }
    for (const candidate of [...(navigator.languages || []), navigator.language]) {
      const detected = normalize(candidate);
      if (detected) return detected;
    }
    try { if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Istanbul') return 'tr'; } catch (_) {}
    return 'en';
  }

  function dictionary(locale) {
    if (locale === 'tr') return { ...(globalThis.__TAHOSAPP_SITE_TR || {}), ...(core.tr || {}) };
    return core[locale] || {};
  }

  function localize(locale) {
    const translations = dictionary(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locales.find(([code]) => code === locale)?.[2] || 'ltr';
    document.querySelector('meta[property="og:locale"]')?.setAttribute('content', locale === 'tr' ? 'tr_TR' : locale.replace('-', '_'));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('script, style, code, pre, [data-i18n-ignore], .language-picker')) continue;
      const original = originalText.get(node) || node.nodeValue;
      originalText.set(node, original);
      const clean = original.trim();
      const replacement = locale === 'en' ? clean : translations[clean];
      if (replacement) node.nodeValue = `${original.match(/^\s*/)?.[0] || ''}${replacement}${original.match(/\s*$/)?.[0] || ''}`;
      else if (locale === 'en') node.nodeValue = original;
    }
    document.querySelectorAll('[title], [aria-label], [placeholder]').forEach(element => {
      const saved = originalAttributes.get(element) || {};
      ['title', 'aria-label', 'placeholder'].forEach(attribute => {
        if (!element.hasAttribute(attribute)) return;
        saved[attribute] ||= element.getAttribute(attribute);
        const original = saved[attribute];
        element.setAttribute(attribute, locale === 'en' ? original : translations[original] || original);
      });
      originalAttributes.set(element, saved);
    });
    localStorage.setItem(storageKey, locale);
    const selector = document.querySelector('[data-language-select]');
    if (selector) selector.value = locale;
  }

  function addSelector(locale) {
    const host = document.querySelector('.site-nav') || document.querySelector('.header-inner');
    if (!host || host.querySelector('.language-picker')) return;
    const label = document.createElement('label');
    label.className = 'language-picker';
    label.setAttribute('aria-label', 'Language');
    const select = document.createElement('select');
    select.dataset.languageSelect = '';
    locales.forEach(([code, name]) => select.add(new Option(name, code)));
    select.value = locale;
    select.addEventListener('change', () => {
      localStorage.setItem(explicitKey, '1');
      localize(select.value);
    });
    label.append(select);
    host.append(label);
  }

  const locale = detect();
  addSelector(locale);
  localize(locale);
})();
