// popup.js – AutoWebScroller v1.2  (Safari Web Extension API)

(() => {
  // ─── i18n ─────────────────────────────────────────────────────────────────────
  const I18N = {
    ko: {
      speed_title:    '🚀 속도',
      dir_title:      '🧭 방향',
      opt_title:      '⚙️ 옵션',
      timer_title:    '⏱ 타이머',
      gesture_title:  '👋 제스처 단축키',
      widget_title:   '🎛 플로팅 위젯',
      slow:           '느림',
      fast:           '빠름',
      dir_down:       '↓ 아래',
      dir_up:         '↑ 위',
      loop_label:     '루프 모드',
      loop_desc:      '끝에서 처음으로 돌아감',
      autopause_label:'자동 일시정지',
      autopause_desc: '터치 즉시 멈춤, 3초 후 재개',
      timer_off:      '끔',
      timer_60min:    '60분',
      min_unit:       '분',
      gesture_label:  '제스처 단축키',
      gesture_desc:   '더블탭: 일시정지/재개 · 트리플탭: 속도 초기화',
      widget_label:       '미니 컨트롤 표시',
      widget_desc:        '페이지 위에 드래그 가능한 위젯 표시',
      widget_orient_label:'위젯 방향',
      widget_orient_v:    '세로',
      widget_orient_h:    '가로',
      speed_mode_label:   '속도 곡선',
      speed_mode_curve:   '곡선',
      speed_mode_linear:  '선형',
      start:          '시작',
      stop:           '정지',
      quit_title:     '종료',
    },
    en: {
      speed_title:    '🚀 Speed',
      dir_title:      '🧭 Direction',
      opt_title:      '⚙️ Options',
      timer_title:    '⏱ Timer',
      gesture_title:  '👋 Gestures',
      widget_title:   '🎛 Floating Widget',
      slow:           'Slow',
      fast:           'Fast',
      dir_down:       '↓ Down',
      dir_up:         '↑ Up',
      loop_label:     'Loop Mode',
      loop_desc:      'Returns to top at end',
      autopause_label:'Auto Pause',
      autopause_desc: 'Stops on touch, resumes after 3s',
      timer_off:      'Off',
      timer_60min:    '60 min',
      min_unit:       ' min',
      gesture_label:  'Gesture Shortcuts',
      gesture_desc:   'Double tap: pause/resume · Triple tap: reset speed',
      widget_label:       'Show Mini Control',
      widget_desc:        'Show draggable widget on page',
      widget_orient_label:'Widget Layout',
      widget_orient_v:    'Vertical',
      widget_orient_h:    'Horizontal',
      speed_mode_label:   'Speed Curve',
      speed_mode_curve:   'Curve',
      speed_mode_linear:  'Linear',
      start:          'Start',
      stop:           'Stop',
      quit_title:     'Quit',
    },
    ja: {
      speed_title:    '🚀 スピード',
      dir_title:      '🧭 方向',
      opt_title:      '⚙️ オプション',
      timer_title:    '⏱ タイマー',
      gesture_title:  '👋 ジェスチャー',
      widget_title:   '🎛 ウィジェット',
      slow:           '遅い',
      fast:           '速い',
      dir_down:       '↓ 下',
      dir_up:         '↑ 上',
      loop_label:     'ループモード',
      loop_desc:      '最後に先頭に戻る',
      autopause_label:'自動一時停止',
      autopause_desc: 'タッチで即停止、3秒後再開',
      timer_off:      'オフ',
      timer_60min:    '60分',
      min_unit:       '分',
      gesture_label:  'ジェスチャー',
      gesture_desc:   'ダブルタップ: 一時停止/再開 · トリプル: 速度リセット',
      widget_label:       'ミニコントロール表示',
      widget_desc:        'ページ上にドラッグ可能なウィジェット',
      widget_orient_label:'向き',
      widget_orient_v:    '縦',
      widget_orient_h:    '横',
      speed_mode_label:   '速度カーブ',
      speed_mode_curve:   'カーブ',
      speed_mode_linear:  'リニア',
      start:          '開始',
      stop:           '停止',
      quit_title:     '終了',
    },
    zh: {
      speed_title:    '🚀 速度',
      dir_title:      '🧭 方向',
      opt_title:      '⚙️ 选项',
      timer_title:    '⏱ 计时器',
      gesture_title:  '👋 手势快捷键',
      widget_title:   '🎛 浮动小组件',
      slow:           '慢',
      fast:           '快',
      dir_down:       '↓ 向下',
      dir_up:         '↑ 向上',
      loop_label:     '循环模式',
      loop_desc:      '到达末尾时返回顶部',
      autopause_label:'自动暂停',
      autopause_desc: '触摸立即停止，3秒后恢复',
      timer_off:      '关',
      timer_60min:    '60分钟',
      min_unit:       '分钟',
      gesture_label:  '手势快捷键',
      gesture_desc:   '双击：暂停/恢复 · 三击：重置速度',
      widget_label:       '显示迷你控制',
      widget_desc:        '在页面上显示可拖动小组件',
      widget_orient_label:'方向',
      widget_orient_v:    '竖向',
      widget_orient_h:    '横向',
      speed_mode_label:   '速度曲线',
      speed_mode_curve:   '曲线',
      speed_mode_linear:  '线性',
      start:          '开始',
      stop:           '停止',
      quit_title:     '退出',
    },
    fr: {
      speed_title:    '🚀 Vitesse',
      dir_title:      '🧭 Direction',
      opt_title:      '⚙️ Options',
      timer_title:    '⏱ Minuterie',
      gesture_title:  '👋 Raccourcis',
      widget_title:   '🎛 Widget flottant',
      slow:           'Lent',
      fast:           'Rapide',
      dir_down:       '↓ Bas',
      dir_up:         '↑ Haut',
      loop_label:     'Mode boucle',
      loop_desc:      'Retour en haut à la fin',
      autopause_label:'Pause auto',
      autopause_desc: 'Arrêt tactile, reprise après 3s',
      timer_off:      'Désactivé',
      timer_60min:    '60 min',
      min_unit:       ' min',
      gesture_label:  'Raccourcis gestuels',
      gesture_desc:   'Double: pause/reprise · Triple: réinit. vitesse',
      widget_label:       'Afficher mini contrôle',
      widget_desc:        'Widget draggable sur la page',
      widget_orient_label:'Disposition',
      widget_orient_v:    'Vertical',
      widget_orient_h:    'Horizontal',
      speed_mode_label:   'Courbe de vitesse',
      speed_mode_curve:   'Courbe',
      speed_mode_linear:  'Linéaire',
      start:          'Démarrer',
      stop:           'Arrêter',
      quit_title:     'Quitter',
    },
    hi: {
      speed_title:    '🚀 गति',
      dir_title:      '🧭 दिशा',
      opt_title:      '⚙️ विकल्प',
      timer_title:    '⏱ टाइमर',
      gesture_title:  '👋 जेस्चर',
      widget_title:   '🎛 फ्लोटिंग विजेट',
      slow:           'धीमा',
      fast:           'तेज़',
      dir_down:       '↓ नीचे',
      dir_up:         '↑ ऊपर',
      loop_label:     'लूप मोड',
      loop_desc:      'अंत में शुरू पर वापस',
      autopause_label:'ऑटो पॉज़',
      autopause_desc: 'स्पर्श पर रुके, 3s बाद शुरू',
      timer_off:      'बंद',
      timer_60min:    '60 मिनट',
      min_unit:       ' मिनट',
      gesture_label:  'जेस्चर शॉर्टकट',
      gesture_desc:   'डबल टैप: पॉज़/जारी · ट्रिपल: रीसेट',
      widget_label:       'मिनी कंट्रोल दिखाएं',
      widget_desc:        'पेज पर ड्रैग करने योग्य विजेट',
      widget_orient_label:'लेआउट',
      widget_orient_v:    'लंबवत',
      widget_orient_h:    'क्षैतिज',
      speed_mode_label:   'गति वक्र',
      speed_mode_curve:   'वक्र',
      speed_mode_linear:  'रेखीय',
      start:          'शुरू',
      stop:           'रोकें',
      quit_title:     'समाप्त',
    },
  };

  function getLang() {
    const l = (navigator.language || 'en').toLowerCase();
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('fr')) return 'fr';
    if (l.startsWith('hi')) return 'hi';
    return 'en';
  }
  const _lang = getLang();
  function t(key) { return (I18N[_lang] || I18N.en)[key] || I18N.en[key] || key; }
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
  }

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const toggleBtn        = document.getElementById('toggleBtn');
  const quitBtn          = document.getElementById('quitBtn');
  const statusDot        = document.getElementById('statusDot');
  const speedSlider      = document.getElementById('speedSlider');
  const speedValue       = document.getElementById('speedValue');
  const timerSlider      = document.getElementById('timerSlider');
  const timerValue       = document.getElementById('timerValue');
  const directionBtns    = document.querySelectorAll('#directionControl .seg-btn');
  const loopToggle       = document.getElementById('loopToggle');
  const autoPauseToggle  = document.getElementById('autoPauseToggle');
  const gestureToggle    = document.getElementById('gestureToggle');
  const showWidgetToggle   = document.getElementById('showWidgetToggle');
  const widgetOrientBtns   = document.querySelectorAll('#widgetOrientControl .seg-btn');
  const speedModeBtns      = document.querySelectorAll('#speedModeControl .seg-btn');

  // ─── Storage key ─────────────────────────────────────────────────────────────
  const SETTINGS_KEY = 'aws_settings';

  // Single source of truth for allowed settings keys (mirrors content.js).
  // Used wherever a settings object is merged in — prevents prototype pollution.
  const SETTINGS_KEYS = [
    'speed','speedMode','direction','loop','autoPause','timerMins',
    'gestureShortcuts','showWidget','widgetOrientation'
  ];

  // ─── Local state ─────────────────────────────────────────────────────────────
  let isScrolling = false;
  let settings = {
    speed:            3,
    speedMode:        'curve',
    direction:        'down',
    loop:             false,
    autoPause:        true,
    timerMins:        0,
    gestureShortcuts: true,
    showWidget:        true,
    widgetOrientation: 'vertical'
  };

  // ─── Messaging (WebExtension API) ────────────────────────────────────────────

  async function send(name, message) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        browser.tabs.sendMessage(tabs[0].id, { name, message: message || {} }).catch(() => {});
      }
    } catch (e) {
      console.warn('[AutoWebScroller] send error:', e);
    }
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.name === 'stateChanged') {
      applyState(msg);
    }
  });

  function applyState({ isScrolling: s, settings: cfg }) {
    isScrolling = s;
    if (cfg) {
      for (const k of SETTINGS_KEYS) { if (k in cfg) settings[k] = cfg[k]; }
    }
    renderUI();
  }

  // ─── Render UI ────────────────────────────────────────────────────────────────
  function renderUI() {
    if (isScrolling) {
      toggleBtn.className = 'toggle-btn running';
      toggleBtn.querySelector('.btn-icon').textContent  = '\u23F8\uFE0E';
      toggleBtn.querySelector('.btn-label').textContent = t('stop');
      statusDot.classList.add('active');
    } else {
      toggleBtn.className = 'toggle-btn stopped';
      toggleBtn.querySelector('.btn-icon').textContent  = '\u25B6\uFE0E';
      toggleBtn.querySelector('.btn-label').textContent = t('start');
      statusDot.classList.remove('active');
    }

    speedSlider.value = settings.speed;
    speedValue.textContent = `${settings.speed}x`;

    directionBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === settings.direction);
    });

    loopToggle.checked      = settings.loop;
    autoPauseToggle.checked = settings.autoPause;
    gestureToggle.checked   = settings.gestureShortcuts;
    showWidgetToggle.checked = settings.showWidget;

    widgetOrientBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === settings.widgetOrientation);
    });

    speedModeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === settings.speedMode);
    });

    timerSlider.value = settings.timerMins;
    timerValue.textContent = settings.timerMins === 0
      ? t('timer_off')
      : `${settings.timerMins}${t('min_unit')}`;
  }

  // ─── Push settings to content script ─────────────────────────────────────────
  function pushSettings() {
    send('updateSettings', { ...settings });
    // Save immediately to extension storage — survives popup close & cross-domain
    try {
      browser.storage?.local?.set({ [SETTINGS_KEY]: { ...settings } })?.catch(() => {});
    } catch (_) {}
  }

  // ─── Event listeners ──────────────────────────────────────────────────────────

  toggleBtn.addEventListener('click', () => {
    send('toggle');
    isScrolling = !isScrolling;
    renderUI();
  });

  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      send('quit');
      isScrolling = false;
      settings.showWidget = false;
      renderUI();
    });
  }

  speedSlider.addEventListener('input', () => {
    settings.speed = parseInt(speedSlider.value, 10);
    speedValue.textContent = `${settings.speed}x`;
    pushSettings();
  });

  directionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      settings.direction = btn.dataset.value;
      renderUI();
      pushSettings();
    });
  });

  loopToggle.addEventListener('change', () => {
    settings.loop = loopToggle.checked;
    pushSettings();
  });

  autoPauseToggle.addEventListener('change', () => {
    settings.autoPause = autoPauseToggle.checked;
    pushSettings();
  });

  timerSlider.addEventListener('input', () => {
    settings.timerMins = parseInt(timerSlider.value, 10);
    timerValue.textContent = settings.timerMins === 0
      ? t('timer_off')
      : `${settings.timerMins}${t('min_unit')}`;
    pushSettings();
  });

  gestureToggle.addEventListener('change', () => {
    settings.gestureShortcuts = gestureToggle.checked;
    pushSettings();
  });

  showWidgetToggle.addEventListener('change', () => {
    settings.showWidget = showWidgetToggle.checked;
    send(settings.showWidget ? 'showWidget' : 'hideWidget');
    pushSettings();
  });

  widgetOrientBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      settings.widgetOrientation = btn.dataset.value;
      renderUI();
      pushSettings();
    });
  });

  speedModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      settings.speedMode = btn.dataset.value;
      renderUI();
      pushSettings();
    });
  });

  // ─── Init ─────────────────────────────────────────────────────────────────────
  applyI18n();
  // Pre-load saved settings from extension storage (available even before content responds)
  try {
    browser.storage?.local?.get(SETTINGS_KEY)?.then(result => {
      if (result?.[SETTINGS_KEY]) {
        const stored = result[SETTINGS_KEY];
        // Whitelist merge — never use Object.assign on storage data (prototype pollution risk)
        for (const k of SETTINGS_KEYS) { if (k in stored) settings[k] = stored[k]; }
        renderUI();
      }
    })?.catch(() => {});
  } catch (_) {}
  send('getState');
  renderUI();
})();
