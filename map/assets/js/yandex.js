import { $, $$, toast, fmtDist, fmtTime, escapeHtml } from './core.js';
import { YandexRouter } from './router.js';

let map;
let multiRoute;
let viaPoints = [];
let objectManager;
let fromInput;
let toInput;
let buildButton;
let clearViaButton;
let vehicleRadios = [];
let smartRegistry = new Map();
let currentVehicle = 'car';

const TOOLTIP_TEXT = {
  route: 'Укажите пункты A и B',
  clearVia: 'Нет промежуточных точек для сброса',
};

function setTooltip(target, text) {
  if (!target) return;
  if (text) {
    target.setAttribute('title', text);
  } else {
    target.removeAttribute('title');
  }
}

function setActiveVehicleTab(value) {
  if (!value) return;
  currentVehicle = value;
  vehicleRadios.forEach((radio) => {
    const isActive = radio.value === value;
    radio.checked = isActive;
    const label = radio.closest('.pill');
    if (label) label.classList.toggle('active', isActive);
  });
}

function mapRecommendationTarget(id) {
  return smartRegistry.get(id);
}

export function applySmartButtonsRecommendations(payload = {}) {
  const { recommendations = [] } = payload || {};

  recommendations.forEach((rec) => {
    if (!rec || !rec.button) return;
    const target = mapRecommendationTarget(rec.button);
    if (!target) return;

    switch (rec.action) {
      case 'disable': {
        if (target.type === 'button') {
          target.element.disabled = true;
          setTooltip(target.element, rec.reason || target.defaultTooltip || '');
        }
        break;
      }
      case 'enable': {
        if (target.type === 'button') {
          target.element.disabled = false;
          setTooltip(target.element, null);
        }
        break;
      }
      case 'highlight': {
        if (target.type === 'tab') {
          setActiveVehicleTab(target.value);
        }
        break;
      }
      case 'tooltip': {
        setTooltip(target.element, rec.reason || rec.tooltip || '');
        break;
      }
      default:
        break;
    }
  });
}

async function requestSmartButtonRecommendations() {
  const fromVal = fromInput?.value?.trim();
  const toVal = toInput?.value?.trim();
  const viaCount = viaPoints.length;

  const recommendations = [];

  if (fromVal && toVal) {
    recommendations.push({ button: 'btn-route', action: 'enable' });
  } else {
    recommendations.push({ button: 'btn-route', action: 'disable', reason: TOOLTIP_TEXT.route });
  }

  if (viaCount > 0) {
    recommendations.push({ button: 'btn-clear-via', action: 'enable' });
  } else {
    recommendations.push({ button: 'btn-clear-via', action: 'disable', reason: TOOLTIP_TEXT.clearVia });
  }

  recommendations.push({ button: `tab-${currentVehicle}`, action: 'highlight' });

  // Заглушка для будущей интеграции Smart Buttons AI
  return { recommendations };
}

async function updateSmartButtons() {
  try {
    const data = await requestSmartButtonRecommendations();
    applySmartButtonsRecommendations(data);
  } catch (err) {
    console.warn('[TT] SmartButtons update failed', err);
  }
}

export function init() {
  const cfg = window.TRANSTIME_CONFIG?.yandex;
  if (!cfg?.apiKey) return toast('Ошибка конфигурации: нет API ключа');

  // Защитимся от повторной инициализации
  if (window.__TT_YA_LOADING__) return;
  window.__TT_YA_LOADING__ = true;

  const script = document.createElement('script');
  script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(cfg.apiKey)}&lang=${encodeURIComponent(cfg.lang || 'ru_RU')}&load=package.standard,package.search,multiRouter.MultiRoute,package.geoObjects`;
  script.onload = () => (window.ymaps ? ymaps.ready(setup) : toast('Yandex API не инициализировался'));
  script.onerror = () => toast('Не удалось загрузить Yandex Maps');
  document.head.appendChild(script);
}

  function setup() {
    const cfg = window.TRANSTIME_CONFIG;
    const center = cfg?.map?.center || [55.751244, 37.618423];
    const zoom = cfg?.map?.zoom || 8;

    map = new ymaps.Map('map', { center, zoom, controls: ['zoomControl', 'typeSelector'] }, { suppressMapOpenBlock: true });

    // UI
    const from = $('#from');
    const to = $('#to');
    const buildBtn = $('#buildBtn');
    const clearVia = $('#clearVia');
    const vehRadios = $$('input[name=veh]');

    fromInput = from || null;
    toInput = to || null;
    buildButton = buildBtn || null;
    clearViaButton = clearVia || null;
    vehicleRadios = Array.isArray(vehRadios) ? vehRadios : [];

    smartRegistry = new Map();
    if (buildButton) {
      smartRegistry.set('btn-route', { type: 'button', element: buildButton, defaultTooltip: TOOLTIP_TEXT.route });
    }
    if (clearViaButton) {
      smartRegistry.set('btn-clear-via', { type: 'button', element: clearViaButton, defaultTooltip: TOOLTIP_TEXT.clearVia });
    }

    vehicleRadios.forEach((radio) => {
      const label = radio.closest('label');
      if (label) {
        label.dataset.veh = radio.value;
        smartRegistry.set(`tab-${radio.value}`, { type: 'tab', element: label, value: radio.value });
      }
      radio.addEventListener('change', () => {
        setActiveVehicleTab(radio.value);
        updateSmartButtons();
      });
    });

    const initialVehicle = document.querySelector('input[name=veh]:checked')?.value
      || vehicleRadios[0]?.value
      || currentVehicle;
    setActiveVehicleTab(initialVehicle);

    // Добавление via-точек кликом
    map.events.add('click', (e) => {
      viaPoints.push(e.get('coords'));
      toast(`Добавлена via-точка (${viaPoints.length})`, 2000);
      updateSmartButtons();
    });

    if (fromInput) fromInput.addEventListener('input', () => updateSmartButtons());
    if (toInput) toInput.addEventListener('input', () => updateSmartButtons());

    if (buildBtn) buildBtn.addEventListener('click', onBuild);
    if (clearVia) {
      clearVia.addEventListener('click', () => {
        if (!viaPoints.length) return;
        viaPoints = [];
        toast('Via-точки очищены', 1500);
        updateSmartButtons();
      });
    }

    // Подгружаем рамки (тихо, без падения страницы)
    loadFrames().catch(()=>{});

    updateSmartButtons();

    async function onBuild() {
      try {
        const mode = (document.querySelector('input[name=veh]:checked')?.value || 'truck40');
        const opts = { mode: 'truck' };
        if (mode === 'car') opts.mode = 'auto';
        if (mode === 'truck40') opts.weight = 40000;
        if (mode === 'truckHeavy') opts.weight = 55000;

        const fromVal = fromInput?.value?.trim();
        const toVal = toInput?.value?.trim();
        if (!fromVal || !toVal) throw new Error('Укажи адреса Откуда и Куда');

        const A = await YandexRouter.geocode(fromVal);
        const B = await YandexRouter.geocode(toVal);
        const points = [A, ...viaPoints, B];

        const { multiRoute: mr } = await YandexRouter.build(points, opts);
        if (multiRoute) map.geoObjects.remove(multiRoute);
        multiRoute = mr;
        map.geoObjects.add(multiRoute);
        toast('Маршрут построен', 2000);
      } catch (e) {
        toast(typeof e === 'string' ? e : (e.message || 'Ошибка маршрута'));
      }
    }
  }

async function loadFrames() {
  try {
    const r = await fetch('../data/frames_ready.geojson?v=' + Date.now());
    if (!r.ok) throw new Error('HTTP '+r.status);
    const data = await r.json();
    if (!data || !Array.isArray(data.features)) throw new Error('Некорректный GeoJSON');

    objectManager = new ymaps.ObjectManager({ clusterize: false });
    objectManager.objects.options.set({ preset: 'islands#blueCircleDotIcon' });

    data.features.forEach(f => {
      const p = f.properties || {};
      f.properties = {
        hintContent: p.name || 'Рамка',
        balloonContent: `<b>${escapeHtml(p.name || 'Весовая рамка')}</b>` +
          (p.comment ? `<div class="mt6">${escapeHtml(p.comment)}</div>` : '') +
          (p.date ? `<div class="small mt6">Дата: ${escapeHtml(p.date)}</div>` : '')
      };
    });

    objectManager.add(data);
    map.geoObjects.add(objectManager);
  } catch (e) {
    toast('Рамки не загружены');
  }
}
