export const SUPPORTED_LOCALES = Object.freeze([
  { code: 'tr', label: 'Türkçe', direction: 'ltr' },
  { code: 'en', label: 'English', direction: 'ltr' },
  { code: 'de', label: 'Deutsch', direction: 'ltr' },
  { code: 'fr', label: 'Français', direction: 'ltr' },
  { code: 'es', label: 'Español', direction: 'ltr' },
  { code: 'pt-BR', label: 'Português (Brasil)', direction: 'ltr' },
  { code: 'it', label: 'Italiano', direction: 'ltr' },
  { code: 'ru', label: 'Русский', direction: 'ltr' },
  { code: 'ar', label: 'العربية', direction: 'rtl' },
  { code: 'ja', label: '日本語', direction: 'ltr' },
  { code: 'ko', label: '한국어', direction: 'ltr' },
  { code: 'zh-CN', label: '简体中文', direction: 'ltr' },
]);

export const DEFAULT_LOCALE = 'tr';

const en = {
  'language.title': 'App Language',
  'language.description': 'Choose the language used throughout tahosapp.',
  'language.field': 'Language',
  'language.help': 'Messages, server names, channel names, and other user-written content are not translated.',
  'language.save': 'Save Language',
  'language.saving': 'Saving…',
  'language.saved': 'Language preference saved.',
  'serverNotifications.menu': 'Notification Settings',
  'serverNotifications.title': '{server} notifications',
  'serverNotifications.description': 'These choices apply to every channel in this server unless a channel has its own override.',
  'serverNotifications.level': 'Message notifications',
  'serverNotifications.inherit': 'Use account default',
  'serverNotifications.all': 'All messages',
  'serverNotifications.mentions': 'Mentions only',
  'serverNotifications.nothing': 'Nothing',
  'serverNotifications.everyone': 'Suppress @everyone and @here',
  'serverNotifications.everyoneHelp': 'Do not notify for server-wide mentions.',
  'serverNotifications.roles': 'Suppress role mentions',
  'serverNotifications.rolesHelp': 'Do not notify when one of your roles is mentioned.',
  'serverNotifications.mute': 'Mute server',
  'serverNotifications.notMuted': 'Not muted',
  'serverNotifications.minutes15': '15 minutes',
  'serverNotifications.hour1': '1 hour',
  'serverNotifications.hours8': '8 hours',
  'serverNotifications.hours24': '24 hours',
  'serverNotifications.untilEnabled': 'Until I turn it back on',
  'serverNotifications.save': 'Save Settings',
  'serverNotifications.saving': 'Saving…',
  'serverNotifications.saved': 'Server notification settings saved.',
  'serverNotifications.loadError': 'Notification settings could not be loaded.',
  'serverNotifications.saveError': 'Notification settings could not be saved.',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
};

const tr = {
  'language.title': 'Uygulama Dili',
  'language.description': 'tahosapp genelinde kullanılacak dili seç.',
  'language.field': 'Dil',
  'language.help': 'Mesajlar, sunucu ve kanal adları ile kullanıcıların yazdığı diğer içerikler çevrilmez.',
  'language.save': 'Dili Kaydet',
  'language.saving': 'Kaydediliyor…',
  'language.saved': 'Dil tercihi kaydedildi.',
  'serverNotifications.menu': 'Bildirim Ayarları',
  'serverNotifications.title': '{server} bildirimleri',
  'serverNotifications.description': 'Bir kanala özel ayar yapmadığın sürece bu seçimler sunucudaki tüm kanallara uygulanır.',
  'serverNotifications.level': 'Mesaj bildirimleri',
  'serverNotifications.inherit': 'Hesap varsayılanını kullan',
  'serverNotifications.all': 'Tüm mesajlar',
  'serverNotifications.mentions': 'Yalnızca etiketler',
  'serverNotifications.nothing': 'Hiçbiri',
  'serverNotifications.everyone': '@everyone ve @here bildirimlerini kapat',
  'serverNotifications.everyoneHelp': 'Sunucunun tamamına gönderilen etiketlerde bildirim alma.',
  'serverNotifications.roles': 'Rol etiketlerini kapat',
  'serverNotifications.rolesHelp': 'Rollerinden biri etiketlendiğinde bildirim alma.',
  'serverNotifications.mute': 'Sunucuyu sustur',
  'serverNotifications.notMuted': 'Susturulmadı',
  'serverNotifications.minutes15': '15 dakika',
  'serverNotifications.hour1': '1 saat',
  'serverNotifications.hours8': '8 saat',
  'serverNotifications.hours24': '24 saat',
  'serverNotifications.untilEnabled': 'Ben yeniden açana kadar',
  'serverNotifications.save': 'Ayarları Kaydet',
  'serverNotifications.saving': 'Kaydediliyor…',
  'serverNotifications.saved': 'Sunucu bildirim ayarları kaydedildi.',
  'serverNotifications.loadError': 'Bildirim ayarları yüklenemedi.',
  'serverNotifications.saveError': 'Bildirim ayarları kaydedilemedi.',
  'common.close': 'Kapat',
  'common.cancel': 'İptal',
};

const de = {
  'language.title': 'App-Sprache', 'language.description': 'Wähle die Sprache für tahosapp.', 'language.field': 'Sprache', 'language.help': 'Nachrichten, Server- und Kanalnamen sowie andere Nutzerinhalte werden nicht übersetzt.', 'language.save': 'Sprache speichern', 'language.saving': 'Wird gespeichert…', 'language.saved': 'Spracheinstellung gespeichert.',
  'serverNotifications.menu': 'Benachrichtigungseinstellungen', 'serverNotifications.title': 'Benachrichtigungen für {server}', 'serverNotifications.description': 'Diese Auswahl gilt für alle Kanäle dieses Servers, sofern kein Kanal eine eigene Einstellung hat.', 'serverNotifications.level': 'Nachrichtenbenachrichtigungen', 'serverNotifications.inherit': 'Kontostandard verwenden', 'serverNotifications.all': 'Alle Nachrichten', 'serverNotifications.mentions': 'Nur Erwähnungen', 'serverNotifications.nothing': 'Keine', 'serverNotifications.everyone': '@everyone und @here unterdrücken', 'serverNotifications.everyoneHelp': 'Keine Benachrichtigung bei serverweiten Erwähnungen.', 'serverNotifications.roles': 'Rollenerwähnungen unterdrücken', 'serverNotifications.rolesHelp': 'Keine Benachrichtigung, wenn eine deiner Rollen erwähnt wird.', 'serverNotifications.mute': 'Server stummschalten', 'serverNotifications.notMuted': 'Nicht stummgeschaltet', 'serverNotifications.minutes15': '15 Minuten', 'serverNotifications.hour1': '1 Stunde', 'serverNotifications.hours8': '8 Stunden', 'serverNotifications.hours24': '24 Stunden', 'serverNotifications.untilEnabled': 'Bis ich es wieder einschalte', 'serverNotifications.save': 'Einstellungen speichern', 'serverNotifications.saving': 'Wird gespeichert…', 'serverNotifications.saved': 'Server-Benachrichtigungen gespeichert.', 'serverNotifications.loadError': 'Benachrichtigungen konnten nicht geladen werden.', 'serverNotifications.saveError': 'Benachrichtigungen konnten nicht gespeichert werden.', 'common.close': 'Schließen', 'common.cancel': 'Abbrechen',
};

const fr = {
  'language.title': "Langue de l’application", 'language.description': 'Choisissez la langue utilisée dans tahosapp.', 'language.field': 'Langue', 'language.help': 'Les messages, noms de serveur et de salon et les autres contenus des utilisateurs ne sont pas traduits.', 'language.save': 'Enregistrer la langue', 'language.saving': 'Enregistrement…', 'language.saved': 'Préférence linguistique enregistrée.',
  'serverNotifications.menu': 'Paramètres de notification', 'serverNotifications.title': 'Notifications de {server}', 'serverNotifications.description': 'Ces choix s’appliquent à tous les salons de ce serveur, sauf réglage propre à un salon.', 'serverNotifications.level': 'Notifications de messages', 'serverNotifications.inherit': 'Utiliser le réglage du compte', 'serverNotifications.all': 'Tous les messages', 'serverNotifications.mentions': 'Mentions uniquement', 'serverNotifications.nothing': 'Aucune', 'serverNotifications.everyone': 'Ignorer @everyone et @here', 'serverNotifications.everyoneHelp': 'Ne pas notifier les mentions adressées à tout le serveur.', 'serverNotifications.roles': 'Ignorer les mentions de rôle', 'serverNotifications.rolesHelp': 'Ne pas notifier lorsqu’un de vos rôles est mentionné.', 'serverNotifications.mute': 'Mettre le serveur en sourdine', 'serverNotifications.notMuted': 'Non mis en sourdine', 'serverNotifications.minutes15': '15 minutes', 'serverNotifications.hour1': '1 heure', 'serverNotifications.hours8': '8 heures', 'serverNotifications.hours24': '24 heures', 'serverNotifications.untilEnabled': 'Jusqu’à réactivation', 'serverNotifications.save': 'Enregistrer', 'serverNotifications.saving': 'Enregistrement…', 'serverNotifications.saved': 'Notifications du serveur enregistrées.', 'serverNotifications.loadError': 'Impossible de charger les notifications.', 'serverNotifications.saveError': 'Impossible d’enregistrer les notifications.', 'common.close': 'Fermer', 'common.cancel': 'Annuler',
};

const es = {
  'language.title': 'Idioma de la aplicación', 'language.description': 'Elige el idioma que se usará en tahosapp.', 'language.field': 'Idioma', 'language.help': 'Los mensajes, nombres de servidores y canales y otros contenidos de usuarios no se traducen.', 'language.save': 'Guardar idioma', 'language.saving': 'Guardando…', 'language.saved': 'Preferencia de idioma guardada.',
  'serverNotifications.menu': 'Ajustes de notificaciones', 'serverNotifications.title': 'Notificaciones de {server}', 'serverNotifications.description': 'Estas opciones se aplican a todos los canales del servidor salvo que un canal tenga su propia configuración.', 'serverNotifications.level': 'Notificaciones de mensajes', 'serverNotifications.inherit': 'Usar valor de la cuenta', 'serverNotifications.all': 'Todos los mensajes', 'serverNotifications.mentions': 'Solo menciones', 'serverNotifications.nothing': 'Nada', 'serverNotifications.everyone': 'Silenciar @everyone y @here', 'serverNotifications.everyoneHelp': 'No notificar las menciones para todo el servidor.', 'serverNotifications.roles': 'Silenciar menciones de roles', 'serverNotifications.rolesHelp': 'No notificar cuando se mencione uno de tus roles.', 'serverNotifications.mute': 'Silenciar servidor', 'serverNotifications.notMuted': 'Sin silenciar', 'serverNotifications.minutes15': '15 minutos', 'serverNotifications.hour1': '1 hora', 'serverNotifications.hours8': '8 horas', 'serverNotifications.hours24': '24 horas', 'serverNotifications.untilEnabled': 'Hasta que lo reactive', 'serverNotifications.save': 'Guardar ajustes', 'serverNotifications.saving': 'Guardando…', 'serverNotifications.saved': 'Notificaciones del servidor guardadas.', 'serverNotifications.loadError': 'No se pudieron cargar las notificaciones.', 'serverNotifications.saveError': 'No se pudieron guardar las notificaciones.', 'common.close': 'Cerrar', 'common.cancel': 'Cancelar',
};

const ptBR = {
  'language.title': 'Idioma do aplicativo', 'language.description': 'Escolha o idioma usado em todo o tahosapp.', 'language.field': 'Idioma', 'language.help': 'Mensagens, nomes de servidores e canais e outros conteúdos dos usuários não são traduzidos.', 'language.save': 'Salvar idioma', 'language.saving': 'Salvando…', 'language.saved': 'Preferência de idioma salva.',
  'serverNotifications.menu': 'Configurações de notificação', 'serverNotifications.title': 'Notificações de {server}', 'serverNotifications.description': 'Estas escolhas valem para todos os canais deste servidor, salvo quando um canal tiver sua própria configuração.', 'serverNotifications.level': 'Notificações de mensagens', 'serverNotifications.inherit': 'Usar padrão da conta', 'serverNotifications.all': 'Todas as mensagens', 'serverNotifications.mentions': 'Somente menções', 'serverNotifications.nothing': 'Nenhuma', 'serverNotifications.everyone': 'Suprimir @everyone e @here', 'serverNotifications.everyoneHelp': 'Não avisar sobre menções para todo o servidor.', 'serverNotifications.roles': 'Suprimir menções de cargos', 'serverNotifications.rolesHelp': 'Não avisar quando um de seus cargos for mencionado.', 'serverNotifications.mute': 'Silenciar servidor', 'serverNotifications.notMuted': 'Não silenciado', 'serverNotifications.minutes15': '15 minutos', 'serverNotifications.hour1': '1 hora', 'serverNotifications.hours8': '8 horas', 'serverNotifications.hours24': '24 horas', 'serverNotifications.untilEnabled': 'Até eu reativar', 'serverNotifications.save': 'Salvar configurações', 'serverNotifications.saving': 'Salvando…', 'serverNotifications.saved': 'Notificações do servidor salvas.', 'serverNotifications.loadError': 'Não foi possível carregar as notificações.', 'serverNotifications.saveError': 'Não foi possível salvar as notificações.', 'common.close': 'Fechar', 'common.cancel': 'Cancelar',
};

const it = {
  'language.title': "Lingua dell’app", 'language.description': 'Scegli la lingua usata in tahosapp.', 'language.field': 'Lingua', 'language.help': 'Messaggi, nomi di server e canali e altri contenuti degli utenti non vengono tradotti.', 'language.save': 'Salva lingua', 'language.saving': 'Salvataggio…', 'language.saved': 'Preferenza della lingua salvata.',
  'serverNotifications.menu': 'Impostazioni notifiche', 'serverNotifications.title': 'Notifiche di {server}', 'serverNotifications.description': 'Queste scelte valgono per tutti i canali del server, salvo impostazioni specifiche del canale.', 'serverNotifications.level': 'Notifiche dei messaggi', 'serverNotifications.inherit': "Usa l’impostazione dell’account", 'serverNotifications.all': 'Tutti i messaggi', 'serverNotifications.mentions': 'Solo menzioni', 'serverNotifications.nothing': 'Nessuna', 'serverNotifications.everyone': 'Ignora @everyone e @here', 'serverNotifications.everyoneHelp': 'Non notificare le menzioni rivolte a tutto il server.', 'serverNotifications.roles': 'Ignora menzioni dei ruoli', 'serverNotifications.rolesHelp': 'Non notificare quando viene menzionato un tuo ruolo.', 'serverNotifications.mute': 'Silenzia server', 'serverNotifications.notMuted': 'Non silenziato', 'serverNotifications.minutes15': '15 minuti', 'serverNotifications.hour1': '1 ora', 'serverNotifications.hours8': '8 ore', 'serverNotifications.hours24': '24 ore', 'serverNotifications.untilEnabled': 'Finché non lo riattivo', 'serverNotifications.save': 'Salva impostazioni', 'serverNotifications.saving': 'Salvataggio…', 'serverNotifications.saved': 'Notifiche del server salvate.', 'serverNotifications.loadError': 'Impossibile caricare le notifiche.', 'serverNotifications.saveError': 'Impossibile salvare le notifiche.', 'common.close': 'Chiudi', 'common.cancel': 'Annulla',
};

const ru = {
  'language.title': 'Язык приложения', 'language.description': 'Выберите язык интерфейса tahosapp.', 'language.field': 'Язык', 'language.help': 'Сообщения, названия серверов и каналов и другой пользовательский контент не переводятся.', 'language.save': 'Сохранить язык', 'language.saving': 'Сохранение…', 'language.saved': 'Языковые настройки сохранены.',
  'serverNotifications.menu': 'Настройки уведомлений', 'serverNotifications.title': 'Уведомления {server}', 'serverNotifications.description': 'Эти настройки применяются ко всем каналам сервера, если для канала не задано исключение.', 'serverNotifications.level': 'Уведомления о сообщениях', 'serverNotifications.inherit': 'Использовать настройки аккаунта', 'serverNotifications.all': 'Все сообщения', 'serverNotifications.mentions': 'Только упоминания', 'serverNotifications.nothing': 'Ничего', 'serverNotifications.everyone': 'Отключить @everyone и @here', 'serverNotifications.everyoneHelp': 'Не уведомлять об упоминаниях всего сервера.', 'serverNotifications.roles': 'Отключить упоминания ролей', 'serverNotifications.rolesHelp': 'Не уведомлять при упоминании вашей роли.', 'serverNotifications.mute': 'Заглушить сервер', 'serverNotifications.notMuted': 'Не заглушен', 'serverNotifications.minutes15': '15 минут', 'serverNotifications.hour1': '1 час', 'serverNotifications.hours8': '8 часов', 'serverNotifications.hours24': '24 часа', 'serverNotifications.untilEnabled': 'Пока я не включу снова', 'serverNotifications.save': 'Сохранить настройки', 'serverNotifications.saving': 'Сохранение…', 'serverNotifications.saved': 'Уведомления сервера сохранены.', 'serverNotifications.loadError': 'Не удалось загрузить уведомления.', 'serverNotifications.saveError': 'Не удалось сохранить уведомления.', 'common.close': 'Закрыть', 'common.cancel': 'Отмена',
};

const ar = {
  'language.title': 'لغة التطبيق', 'language.description': 'اختر اللغة المستخدمة في tahosapp.', 'language.field': 'اللغة', 'language.help': 'لا تُترجم الرسائل وأسماء الخوادم والقنوات والمحتوى الذي يكتبه المستخدمون.', 'language.save': 'حفظ اللغة', 'language.saving': 'جارٍ الحفظ…', 'language.saved': 'تم حفظ تفضيل اللغة.',
  'serverNotifications.menu': 'إعدادات الإشعارات', 'serverNotifications.title': 'إشعارات {server}', 'serverNotifications.description': 'تُطبق هذه الخيارات على جميع قنوات الخادم ما لم تكن للقناة إعدادات خاصة.', 'serverNotifications.level': 'إشعارات الرسائل', 'serverNotifications.inherit': 'استخدام إعداد الحساب', 'serverNotifications.all': 'كل الرسائل', 'serverNotifications.mentions': 'الإشارات فقط', 'serverNotifications.nothing': 'لا شيء', 'serverNotifications.everyone': 'كتم @everyone و@here', 'serverNotifications.everyoneHelp': 'لا ترسل إشعارًا للإشارات العامة في الخادم.', 'serverNotifications.roles': 'كتم إشارات الأدوار', 'serverNotifications.rolesHelp': 'لا ترسل إشعارًا عند الإشارة إلى أحد أدوارك.', 'serverNotifications.mute': 'كتم الخادم', 'serverNotifications.notMuted': 'غير مكتوم', 'serverNotifications.minutes15': '15 دقيقة', 'serverNotifications.hour1': 'ساعة واحدة', 'serverNotifications.hours8': '8 ساعات', 'serverNotifications.hours24': '24 ساعة', 'serverNotifications.untilEnabled': 'حتى أعيد تشغيله', 'serverNotifications.save': 'حفظ الإعدادات', 'serverNotifications.saving': 'جارٍ الحفظ…', 'serverNotifications.saved': 'تم حفظ إشعارات الخادم.', 'serverNotifications.loadError': 'تعذر تحميل الإشعارات.', 'serverNotifications.saveError': 'تعذر حفظ الإشعارات.', 'common.close': 'إغلاق', 'common.cancel': 'إلغاء',
};

const ja = {
  'language.title': 'アプリの言語', 'language.description': 'tahosapp 全体で使用する言語を選択します。', 'language.field': '言語', 'language.help': 'メッセージ、サーバー名、チャンネル名など、ユーザーが入力した内容は翻訳されません。', 'language.save': '言語を保存', 'language.saving': '保存中…', 'language.saved': '言語設定を保存しました。',
  'serverNotifications.menu': '通知設定', 'serverNotifications.title': '{server} の通知', 'serverNotifications.description': 'チャンネル固有の設定がない限り、サーバー内のすべてのチャンネルに適用されます。', 'serverNotifications.level': 'メッセージ通知', 'serverNotifications.inherit': 'アカウントの既定値を使用', 'serverNotifications.all': 'すべてのメッセージ', 'serverNotifications.mentions': 'メンションのみ', 'serverNotifications.nothing': 'なし', 'serverNotifications.everyone': '@everyone と @here を抑制', 'serverNotifications.everyoneHelp': 'サーバー全体へのメンションを通知しません。', 'serverNotifications.roles': 'ロールメンションを抑制', 'serverNotifications.rolesHelp': '自分のロールがメンションされても通知しません。', 'serverNotifications.mute': 'サーバーをミュート', 'serverNotifications.notMuted': 'ミュートしない', 'serverNotifications.minutes15': '15分', 'serverNotifications.hour1': '1時間', 'serverNotifications.hours8': '8時間', 'serverNotifications.hours24': '24時間', 'serverNotifications.untilEnabled': '再び有効にするまで', 'serverNotifications.save': '設定を保存', 'serverNotifications.saving': '保存中…', 'serverNotifications.saved': 'サーバー通知を保存しました。', 'serverNotifications.loadError': '通知を読み込めませんでした。', 'serverNotifications.saveError': '通知を保存できませんでした。', 'common.close': '閉じる', 'common.cancel': 'キャンセル',
};

const ko = {
  'language.title': '앱 언어', 'language.description': 'tahosapp 전체에서 사용할 언어를 선택하세요.', 'language.field': '언어', 'language.help': '메시지, 서버 및 채널 이름과 사용자가 작성한 콘텐츠는 번역되지 않습니다.', 'language.save': '언어 저장', 'language.saving': '저장 중…', 'language.saved': '언어 설정을 저장했습니다.',
  'serverNotifications.menu': '알림 설정', 'serverNotifications.title': '{server} 알림', 'serverNotifications.description': '채널별 설정이 없는 한 서버의 모든 채널에 적용됩니다.', 'serverNotifications.level': '메시지 알림', 'serverNotifications.inherit': '계정 기본값 사용', 'serverNotifications.all': '모든 메시지', 'serverNotifications.mentions': '멘션만', 'serverNotifications.nothing': '없음', 'serverNotifications.everyone': '@everyone 및 @here 숨기기', 'serverNotifications.everyoneHelp': '서버 전체 멘션을 알리지 않습니다.', 'serverNotifications.roles': '역할 멘션 숨기기', 'serverNotifications.rolesHelp': '내 역할이 언급되어도 알리지 않습니다.', 'serverNotifications.mute': '서버 음소거', 'serverNotifications.notMuted': '음소거 안 함', 'serverNotifications.minutes15': '15분', 'serverNotifications.hour1': '1시간', 'serverNotifications.hours8': '8시간', 'serverNotifications.hours24': '24시간', 'serverNotifications.untilEnabled': '다시 켤 때까지', 'serverNotifications.save': '설정 저장', 'serverNotifications.saving': '저장 중…', 'serverNotifications.saved': '서버 알림을 저장했습니다.', 'serverNotifications.loadError': '알림을 불러오지 못했습니다.', 'serverNotifications.saveError': '알림을 저장하지 못했습니다.', 'common.close': '닫기', 'common.cancel': '취소',
};

const zhCN = {
  'language.title': '应用语言', 'language.description': '选择 tahosapp 全局使用的语言。', 'language.field': '语言', 'language.help': '消息、服务器和频道名称以及用户编写的其他内容不会被翻译。', 'language.save': '保存语言', 'language.saving': '正在保存…', 'language.saved': '语言偏好已保存。',
  'serverNotifications.menu': '通知设置', 'serverNotifications.title': '{server} 通知', 'serverNotifications.description': '除非频道有单独设置，否则这些选项会应用于服务器中的所有频道。', 'serverNotifications.level': '消息通知', 'serverNotifications.inherit': '使用账户默认设置', 'serverNotifications.all': '所有消息', 'serverNotifications.mentions': '仅提及', 'serverNotifications.nothing': '无', 'serverNotifications.everyone': '忽略 @everyone 和 @here', 'serverNotifications.everyoneHelp': '不通知服务器范围的提及。', 'serverNotifications.roles': '忽略身份组提及', 'serverNotifications.rolesHelp': '当你的身份组被提及时不通知。', 'serverNotifications.mute': '将服务器静音', 'serverNotifications.notMuted': '未静音', 'serverNotifications.minutes15': '15 分钟', 'serverNotifications.hour1': '1 小时', 'serverNotifications.hours8': '8 小时', 'serverNotifications.hours24': '24 小时', 'serverNotifications.untilEnabled': '直到我重新开启', 'serverNotifications.save': '保存设置', 'serverNotifications.saving': '正在保存…', 'serverNotifications.saved': '服务器通知已保存。', 'serverNotifications.loadError': '无法加载通知设置。', 'serverNotifications.saveError': '无法保存通知设置。', 'common.close': '关闭', 'common.cancel': '取消',
};

export const MESSAGES = Object.freeze({ tr, en, de, fr, es, 'pt-BR': ptBR, it, ru, ar, ja, ko, 'zh-CN': zhCN });

export function normalizeLocale(value) {
  const candidate = String(value || '').trim();
  if (MESSAGES[candidate]) return candidate;
  const lower = candidate.toLowerCase();
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('zh')) return 'zh-CN';
  const base = lower.split('-')[0];
  return SUPPORTED_LOCALES.find(locale => locale.code.toLowerCase() === base)?.code || null;
}

export function detectLocale() {
  const candidates = typeof navigator === 'undefined' ? [] : [...(navigator.languages || []), navigator.language];
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  try {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Istanbul') return 'tr';
  } catch (_) {
    // Use the product default when regional settings are unavailable.
  }
  return DEFAULT_LOCALE;
}

export function translate(locale, key, variables = {}) {
  const template = MESSAGES[normalizeLocale(locale) || DEFAULT_LOCALE]?.[key] ?? en[key] ?? key;
  return Object.entries(variables).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value ?? '')),
    template,
  );
}
