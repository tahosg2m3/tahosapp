import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import legacyTurkish from './legacyTurkish.generated';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, detectLocale, normalizeLocale, translate } from './catalog';

const STORAGE_KEY = 'tahosapp:locale';
const EXPLICIT_KEY = 'tahosapp:locale:explicit';
const LEGACY_STORAGE_KEY = 'chat:locale';
const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'placeholder', 'title'];
const nodeState = new WeakMap();
const attributeState = new WeakMap();

const COMMON_TEXT = {
  'Welcome back!': { tr: 'Tekrar hoş geldin!', de: 'Willkommen zurück!', fr: 'Bon retour !', es: '¡Te damos la bienvenida!', 'pt-BR': 'Boas-vindas de volta!', it: 'Bentornato!', ru: 'С возвращением!', ar: 'مرحبًا بعودتك!', ja: 'おかえりなさい！', ko: '다시 오신 것을 환영합니다!', 'zh-CN': '欢迎回来！' },
  Email: { tr: 'E-posta', de: 'E-Mail', fr: 'E-mail', es: 'Correo electrónico', 'pt-BR': 'E-mail', it: 'E-mail', ru: 'Эл. почта', ar: 'البريد الإلكتروني', ja: 'メール', ko: '이메일', 'zh-CN': '电子邮箱' },
  Password: { tr: 'Parola', de: 'Passwort', fr: 'Mot de passe', es: 'Contraseña', 'pt-BR': 'Senha', it: 'Password', ru: 'Пароль', ar: 'كلمة المرور', ja: 'パスワード', ko: '비밀번호', 'zh-CN': '密码' },
  'Log In': { tr: 'Giriş Yap', de: 'Anmelden', fr: 'Se connecter', es: 'Iniciar sesión', 'pt-BR': 'Entrar', it: 'Accedi', ru: 'Войти', ar: 'تسجيل الدخول', ja: 'ログイン', ko: '로그인', 'zh-CN': '登录' },
  'Need an account?': { tr: 'Hesabın yok mu?', de: 'Noch kein Konto?', fr: 'Besoin d’un compte ?', es: '¿Necesitas una cuenta?', 'pt-BR': 'Precisa de uma conta?', it: 'Ti serve un account?', ru: 'Нет аккаунта?', ar: 'تحتاج إلى حساب؟', ja: 'アカウントが必要ですか？', ko: '계정이 필요하신가요?', 'zh-CN': '还没有账户？' },
  'Sign Up': { tr: 'Kaydol', de: 'Registrieren', fr: 'S’inscrire', es: 'Registrarse', 'pt-BR': 'Cadastrar', it: 'Registrati', ru: 'Регистрация', ar: 'إنشاء حساب', ja: '登録', ko: '가입', 'zh-CN': '注册' },
  'Forgot password': { tr: 'Şifremi unuttum', de: 'Passwort vergessen', fr: 'Mot de passe oublié', es: 'Olvidé mi contraseña', 'pt-BR': 'Esqueci a senha', it: 'Password dimenticata', ru: 'Забыли пароль', ar: 'نسيت كلمة المرور', ja: 'パスワードを忘れた', ko: '비밀번호 찾기', 'zh-CN': '忘记密码' },
  'Create an account': { tr: 'Hesap oluştur', de: 'Konto erstellen', fr: 'Créer un compte', es: 'Crear una cuenta', 'pt-BR': 'Criar uma conta', it: 'Crea un account', ru: 'Создать аккаунт', ar: 'إنشاء حساب', ja: 'アカウントを作成', ko: '계정 만들기', 'zh-CN': '创建账户' },
  Username: { tr: 'Kullanıcı adı', de: 'Benutzername', fr: 'Nom d’utilisateur', es: 'Nombre de usuario', 'pt-BR': 'Nome de usuário', it: 'Nome utente', ru: 'Имя пользователя', ar: 'اسم المستخدم', ja: 'ユーザー名', ko: '사용자 이름', 'zh-CN': '用户名' },
  'Already have an account?': { tr: 'Zaten hesabın var mı?', de: 'Du hast bereits ein Konto?', fr: 'Vous avez déjà un compte ?', es: '¿Ya tienes una cuenta?', 'pt-BR': 'Já tem uma conta?', it: 'Hai già un account?', ru: 'Уже есть аккаунт?', ar: 'لديك حساب بالفعل؟', ja: 'すでにアカウントをお持ちですか？', ko: '이미 계정이 있으신가요?', 'zh-CN': '已有账户？' },
  'Check your email': { tr: 'E-postanı kontrol et', de: 'Prüfe deine E-Mails', fr: 'Consultez vos e-mails', es: 'Revisa tu correo', 'pt-BR': 'Confira seu e-mail', it: 'Controlla la tua e-mail', ru: 'Проверьте почту', ar: 'تحقق من بريدك الإلكتروني', ja: 'メールを確認してください', ko: '이메일을 확인하세요', 'zh-CN': '请检查邮箱' },
  'Verify your email': { tr: 'E-postanı doğrula', de: 'E-Mail bestätigen', fr: 'Vérifiez votre e-mail', es: 'Verifica tu correo', 'pt-BR': 'Verifique seu e-mail', it: 'Verifica la tua e-mail', ru: 'Подтвердите почту', ar: 'تحقق من بريدك الإلكتروني', ja: 'メールを確認', ko: '이메일 인증', 'zh-CN': '验证邮箱' },
  'Verify Code': { tr: 'Kodu Doğrula', de: 'Code bestätigen', fr: 'Vérifier le code', es: 'Verificar código', 'pt-BR': 'Verificar código', it: 'Verifica codice', ru: 'Подтвердить код', ar: 'تحقق من الرمز', ja: 'コードを確認', ko: '코드 확인', 'zh-CN': '验证代码' },
  'Back to login': { tr: 'Girişe dön', de: 'Zurück zur Anmeldung', fr: 'Retour à la connexion', es: 'Volver al inicio', 'pt-BR': 'Voltar ao login', it: 'Torna al login', ru: 'Вернуться ко входу', ar: 'العودة لتسجيل الدخول', ja: 'ログインに戻る', ko: '로그인으로 돌아가기', 'zh-CN': '返回登录' },
  'Resend code': { tr: 'Kodu yeniden gönder', de: 'Code erneut senden', fr: 'Renvoyer le code', es: 'Reenviar código', 'pt-BR': 'Reenviar código', it: 'Invia di nuovo il codice', ru: 'Отправить код снова', ar: 'إعادة إرسال الرمز', ja: 'コードを再送', ko: '코드 재전송', 'zh-CN': '重新发送代码' },
  'Reset your password': { tr: 'Parolanı sıfırla', de: 'Passwort zurücksetzen', fr: 'Réinitialiser le mot de passe', es: 'Restablecer contraseña', 'pt-BR': 'Redefinir senha', it: 'Reimposta la password', ru: 'Сбросить пароль', ar: 'إعادة تعيين كلمة المرور', ja: 'パスワードをリセット', ko: '비밀번호 재설정', 'zh-CN': '重置密码' },
  'Send reset code': { tr: 'Sıfırlama kodu gönder', de: 'Rücksetzcode senden', fr: 'Envoyer le code', es: 'Enviar código', 'pt-BR': 'Enviar código', it: 'Invia codice', ru: 'Отправить код', ar: 'إرسال رمز إعادة التعيين', ja: 'リセットコードを送信', ko: '재설정 코드 보내기', 'zh-CN': '发送重置码' },
  'Update password': { tr: 'Parolayı güncelle', de: 'Passwort aktualisieren', fr: 'Mettre à jour le mot de passe', es: 'Actualizar contraseña', 'pt-BR': 'Atualizar senha', it: 'Aggiorna password', ru: 'Обновить пароль', ar: 'تحديث كلمة المرور', ja: 'パスワードを更新', ko: '비밀번호 변경', 'zh-CN': '更新密码' },
  Settings: { tr: 'Ayarlar', de: 'Einstellungen', fr: 'Paramètres', es: 'Ajustes', 'pt-BR': 'Configurações', it: 'Impostazioni', ru: 'Настройки', ar: 'الإعدادات', ja: '設定', ko: '설정', 'zh-CN': '设置' },
  Friends: { tr: 'Arkadaşlar', de: 'Freunde', fr: 'Amis', es: 'Amigos', 'pt-BR': 'Amigos', it: 'Amici', ru: 'Друзья', ar: 'الأصدقاء', ja: 'フレンド', ko: '친구', 'zh-CN': '好友' },
  Online: { tr: 'Çevrimiçi', de: 'Online', fr: 'En ligne', es: 'En línea', 'pt-BR': 'Online', it: 'Online', ru: 'В сети', ar: 'متصل', ja: 'オンライン', ko: '온라인', 'zh-CN': '在线' },
  All: { tr: 'Tümü', de: 'Alle', fr: 'Tous', es: 'Todos', 'pt-BR': 'Todos', it: 'Tutti', ru: 'Все', ar: 'الكل', ja: 'すべて', ko: '전체', 'zh-CN': '全部' },
  Pending: { tr: 'Bekleyen', de: 'Ausstehend', fr: 'En attente', es: 'Pendientes', 'pt-BR': 'Pendentes', it: 'In attesa', ru: 'Ожидают', ar: 'قيد الانتظار', ja: '保留中', ko: '대기 중', 'zh-CN': '待处理' },
  'Add Friend': { tr: 'Arkadaş Ekle', de: 'Freund hinzufügen', fr: 'Ajouter un ami', es: 'Añadir amigo', 'pt-BR': 'Adicionar amigo', it: 'Aggiungi amico', ru: 'Добавить друга', ar: 'إضافة صديق', ja: 'フレンドを追加', ko: '친구 추가', 'zh-CN': '添加好友' },
  'DIRECT MESSAGES': { tr: 'DOĞRUDAN MESAJLAR', de: 'DIREKTNACHRICHTEN', fr: 'MESSAGES PRIVÉS', es: 'MENSAJES DIRECTOS', 'pt-BR': 'MENSAGENS DIRETAS', it: 'MESSAGGI DIRETTI', ru: 'ЛИЧНЫЕ СООБЩЕНИЯ', ar: 'الرسائل المباشرة', ja: 'ダイレクトメッセージ', ko: '다이렉트 메시지', 'zh-CN': '私信' },
  'Invite people': { tr: 'İnsanları davet et', de: 'Personen einladen', fr: 'Inviter des personnes', es: 'Invitar personas', 'pt-BR': 'Convidar pessoas', it: 'Invita persone', ru: 'Пригласить людей', ar: 'دعوة أشخاص', ja: 'メンバーを招待', ko: '사용자 초대', 'zh-CN': '邀请成员' },
  Events: { tr: 'Etkinlikler', de: 'Veranstaltungen', fr: 'Événements', es: 'Eventos', 'pt-BR': 'Eventos', it: 'Eventi', ru: 'События', ar: 'الفعاليات', ja: 'イベント', ko: '이벤트', 'zh-CN': '活动' },
  'Edit server profile': { tr: 'Sunucu profilini düzenle', de: 'Serverprofil bearbeiten', fr: 'Modifier le profil du serveur', es: 'Editar perfil del servidor', 'pt-BR': 'Editar perfil do servidor', it: 'Modifica profilo server', ru: 'Изменить профиль сервера', ar: 'تعديل ملف الخادم', ja: 'サーバープロフィールを編集', ko: '서버 프로필 편집', 'zh-CN': '编辑服务器资料' },
  'Server settings and community': { tr: 'Sunucu ayarları ve topluluk', de: 'Server- und Community-Einstellungen', fr: 'Paramètres du serveur et de la communauté', es: 'Ajustes del servidor y la comunidad', 'pt-BR': 'Configurações do servidor e comunidade', it: 'Impostazioni server e comunità', ru: 'Настройки сервера и сообщества', ar: 'إعدادات الخادم والمجتمع', ja: 'サーバーとコミュニティの設定', ko: '서버 및 커뮤니티 설정', 'zh-CN': '服务器与社区设置' },
  'Community Hub': { tr: 'Topluluk Merkezi', de: 'Community-Bereich', fr: 'Espace communauté', es: 'Centro de comunidad', 'pt-BR': 'Central da comunidade', it: 'Centro comunità', ru: 'Центр сообщества', ar: 'مركز المجتمع', ja: 'コミュニティハブ', ko: '커뮤니티 허브', 'zh-CN': '社区中心' },
  'Manage members': { tr: 'Üyeleri yönet', de: 'Mitglieder verwalten', fr: 'Gérer les membres', es: 'Gestionar miembros', 'pt-BR': 'Gerenciar membros', it: 'Gestisci membri', ru: 'Управление участниками', ar: 'إدارة الأعضاء', ja: 'メンバーを管理', ko: '멤버 관리', 'zh-CN': '管理成员' },
  'Leave server': { tr: 'Sunucudan ayrıl', de: 'Server verlassen', fr: 'Quitter le serveur', es: 'Salir del servidor', 'pt-BR': 'Sair do servidor', it: 'Lascia il server', ru: 'Покинуть сервер', ar: 'مغادرة الخادم', ja: 'サーバーから退出', ko: '서버 나가기', 'zh-CN': '退出服务器' },
  'TEXT CHANNELS': { tr: 'METİN KANALLARI', de: 'TEXTKANÄLE', fr: 'SALONS TEXTUELS', es: 'CANALES DE TEXTO', 'pt-BR': 'CANAIS DE TEXTO', it: 'CANALI DI TESTO', ru: 'ТЕКСТОВЫЕ КАНАЛЫ', ar: 'القنوات النصية', ja: 'テキストチャンネル', ko: '텍스트 채널', 'zh-CN': '文字频道' },
  'VOICE CHANNELS': { tr: 'SES KANALLARI', de: 'SPRACHKANÄLE', fr: 'SALONS VOCAUX', es: 'CANALES DE VOZ', 'pt-BR': 'CANAIS DE VOZ', it: 'CANALI VOCALI', ru: 'ГОЛОСОВЫЕ КАНАЛЫ', ar: 'القنوات الصوتية', ja: 'ボイスチャンネル', ko: '음성 채널', 'zh-CN': '语音频道' },
  'No Channel Selected': { tr: 'Kanal Seçilmedi', de: 'Kein Kanal ausgewählt', fr: 'Aucun salon sélectionné', es: 'Ningún canal seleccionado', 'pt-BR': 'Nenhum canal selecionado', it: 'Nessun canale selezionato', ru: 'Канал не выбран', ar: 'لم يتم اختيار قناة', ja: 'チャンネルが選択されていません', ko: '선택된 채널 없음', 'zh-CN': '未选择频道' },
  'Select a text or voice channel on the left to start chatting.': { tr: 'Sohbete başlamak için soldan bir metin veya ses kanalı seç.', de: 'Wähle links einen Text- oder Sprachkanal aus.', fr: 'Sélectionnez un salon textuel ou vocal à gauche.', es: 'Selecciona un canal de texto o voz a la izquierda.', 'pt-BR': 'Selecione um canal de texto ou voz à esquerda.', it: 'Seleziona un canale di testo o vocale a sinistra.', ru: 'Выберите текстовый или голосовой канал слева.', ar: 'اختر قناة نصية أو صوتية من اليسار.', ja: '左側からテキストまたはボイスチャンネルを選択してください。', ko: '왼쪽에서 텍스트 또는 음성 채널을 선택하세요.', 'zh-CN': '请从左侧选择文字或语音频道。' },
  'My Account': { tr: 'Hesabım', de: 'Mein Konto', fr: 'Mon compte', es: 'Mi cuenta', 'pt-BR': 'Minha conta', it: 'Il mio account', ru: 'Мой аккаунт', ar: 'حسابي', ja: 'マイアカウント', ko: '내 계정', 'zh-CN': '我的账户' },
  Profiles: { tr: 'Profiller', de: 'Profile', fr: 'Profils', es: 'Perfiles', 'pt-BR': 'Perfis', it: 'Profili', ru: 'Профили', ar: 'الملفات الشخصية', ja: 'プロフィール', ko: '프로필', 'zh-CN': '个人资料' },
  'Privacy & Safety': { tr: 'Gizlilik ve Güvenlik', de: 'Datenschutz & Sicherheit', fr: 'Confidentialité et sécurité', es: 'Privacidad y seguridad', 'pt-BR': 'Privacidade e segurança', it: 'Privacy e sicurezza', ru: 'Конфиденциальность и безопасность', ar: 'الخصوصية والأمان', ja: 'プライバシーと安全', ko: '개인정보 및 보안', 'zh-CN': '隐私与安全' },
  'Voice & Video': { tr: 'Ses ve Görüntü', de: 'Sprache & Video', fr: 'Voix et vidéo', es: 'Voz y vídeo', 'pt-BR': 'Voz e vídeo', it: 'Voce e video', ru: 'Голос и видео', ar: 'الصوت والفيديو', ja: '音声・ビデオ', ko: '음성 및 비디오', 'zh-CN': '语音与视频' },
  Notifications: { tr: 'Bildirimler', de: 'Benachrichtigungen', fr: 'Notifications', es: 'Notificaciones', 'pt-BR': 'Notificações', it: 'Notifiche', ru: 'Уведомления', ar: 'الإشعارات', ja: '通知', ko: '알림', 'zh-CN': '通知' },
  Appearance: { tr: 'Görünüm', de: 'Darstellung', fr: 'Apparence', es: 'Apariencia', 'pt-BR': 'Aparência', it: 'Aspetto', ru: 'Внешний вид', ar: 'المظهر', ja: '外観', ko: '디자인', 'zh-CN': '外观' },
  Accessibility: { tr: 'Erişilebilirlik', de: 'Barrierefreiheit', fr: 'Accessibilité', es: 'Accesibilidad', 'pt-BR': 'Acessibilidade', it: 'Accessibilità', ru: 'Специальные возможности', ar: 'إمكانية الوصول', ja: 'アクセシビリティ', ko: '접근성', 'zh-CN': '辅助功能' },
  Language: { tr: 'Dil', de: 'Sprache', fr: 'Langue', es: 'Idioma', 'pt-BR': 'Idioma', it: 'Lingua', ru: 'Язык', ar: 'اللغة', ja: '言語', ko: '언어', 'zh-CN': '语言' },
  Updates: { tr: 'Güncellemeler', de: 'Updates', fr: 'Mises à jour', es: 'Actualizaciones', 'pt-BR': 'Atualizações', it: 'Aggiornamenti', ru: 'Обновления', ar: 'التحديثات', ja: 'アップデート', ko: '업데이트', 'zh-CN': '更新' },
  'Share a Spotify track': { tr: 'Spotify parçası paylaş' },
  'Paste a Spotify track link, then send the invitation.': { tr: 'Spotify parça bağlantısını yapıştır ve daveti gönder.' },
  'Close Spotify invitation': { tr: 'Spotify davetini kapat' },
  Send: { tr: 'Gönder' },
  'Sending…': { tr: 'Gönderiliyor…' },
};

function initialLocale() {
  const explicit = localStorage.getItem(EXPLICIT_KEY) === '1';
  if (explicit) {
    const saved = normalizeLocale(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
    if (saved) return saved;
  }
  return detectLocale();
}

function translatedText(value, locale) {
  if (!value || locale === 'en') return value;
  const whitespace = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const clean = value.trim();
  const common = COMMON_TEXT[clean]?.[locale];
  const localized = common || (locale === 'tr' ? legacyTurkish[clean] : null);
  return localized ? `${whitespace}${localized}${trailing}` : value;
}

function isIgnored(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !element || element.closest('[data-i18n-ignore], script, style, code, pre');
}

function localizeTextNode(node, locale, externalMutation = false) {
  if (!node?.nodeValue || isIgnored(node)) return;
  const previous = nodeState.get(node);
  const original = externalMutation && previous && node.nodeValue !== previous.applied ? node.nodeValue : previous?.original || node.nodeValue;
  const applied = translatedText(original, locale);
  nodeState.set(node, { original, applied });
  if (node.nodeValue !== applied) node.nodeValue = applied;
}

function localizeElement(element, locale, externalMutation = false) {
  if (!(element instanceof Element) || isIgnored(element)) return;
  const saved = attributeState.get(element) || {};
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const current = element.getAttribute(attribute);
    const previous = saved[attribute];
    const original = externalMutation && previous && current !== previous.applied ? current : previous?.original || current;
    const applied = translatedText(original, locale);
    saved[attribute] = { original, applied };
    if (current !== applied) element.setAttribute(attribute, applied);
  }
  attributeState.set(element, saved);
  element.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) localizeTextNode(child, locale, externalMutation);
    else if (child.nodeType === Node.ELEMENT_NODE) localizeElement(child, locale, externalMutation);
  });
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(initialLocale);

  const setLocale = useCallback((nextLocale, options = {}) => {
    const normalized = normalizeLocale(nextLocale) || DEFAULT_LOCALE;
    setLocaleState(normalized);
    localStorage.setItem(STORAGE_KEY, normalized);
    localStorage.setItem(LEGACY_STORAGE_KEY, normalized);
    if (options.explicit !== false) localStorage.setItem(EXPLICIT_KEY, '1');
  }, []);

  useEffect(() => {
    const metadata = SUPPORTED_LOCALES.find(item => item.code === locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = metadata?.direction || 'ltr';
    localStorage.setItem(STORAGE_KEY, locale);
    localStorage.setItem(LEGACY_STORAGE_KEY, locale);
    localizeElement(document.body, locale);

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'characterData') localizeTextNode(mutation.target, locale, true);
        if (mutation.type === 'attributes') localizeElement(mutation.target, locale, true);
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node, locale);
          else if (node.nodeType === Node.ELEMENT_NODE) localizeElement(node, locale);
        });
      });
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TRANSLATABLE_ATTRIBUTES });
    return () => observer.disconnect();
  }, [locale]);

  const t = useCallback((key, variables) => translate(locale, key, variables), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, locales: SUPPORTED_LOCALES }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider.');
  return value;
}
