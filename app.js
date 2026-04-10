(function () {
  const { createClient } = window.supabase;

  if (!window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_ANON_KEY) {
    alert('Falta config.js con SUPABASE_URL y SUPABASE_ANON_KEY.');
    return;
  }

  const supabase = createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY
  );

  const state = {
    settings: null,
    members: [],
    drinks: [],
    foods: [],
    ordersEffective: [],
    schedule: null,
  };

  const views = {
    home: document.getElementById('view-home'),
    order: document.getElementById('view-order'),
    'summary-pin': document.getElementById('view-summary-pin'),
    summary: document.getElementById('view-summary'),
    'settings-pin': document.getElementById('view-settings-pin'),
    settings: document.getElementById('view-settings'),
  };

  setupNavigation();
  setupOrderForm();
  setupPins();
  setupSettings();
  init();

  async function init() {
    await loadBootData();
    renderOrderOptions();
  }

  function setupNavigation() {
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', async () => {
        const targetView = button.dataset.view;
        showView(targetView);
        if (targetView === 'order') {
          await loadBootData();
          renderOrderOptions();
          clearMessage('orderMsg');
        }
      });
    });
  }

  function showView(name) {
    Object.values(views).forEach((view) => view.classList.remove('active'));
    views[name].classList.add('active');
  }

  async function loadBootData() {
    const [settingsRes, membersRes, drinksRes, foodsRes] = await Promise.all([
      supabase.from('settings').select('*').limit(1).maybeSingle(),
      supabase.from('members').select('*').order('name', { ascending: true }),
      supabase.from('drink_options').select('*').order('name', { ascending: true }),
      supabase.from('food_options').select('*').order('name', { ascending: true }),
    ]);

    handleError(settingsRes.error, 'Error al cargar ajustes.');
    handleError(membersRes.error, 'Error al cargar miembros.');
    handleError(drinksRes.error, 'Error al cargar bebidas.');
    handleError(foodsRes.error, 'Error al cargar comidas.');

    state.settings = settingsRes.data || {};
    state.members = membersRes.data || [];
    state.drinks = drinksRes.data || [];
    state.foods = foodsRes.data || [];
    state.schedule = getEffectiveSchedule(state.settings);
    await loadOrdersForDate(state.schedule.orderDateISO);
    renderScheduleUI();
  }

  async function loadOrdersForDate(orderDateISO) {
    const res = await supabase
      .from('orders')
      .select('*')
      .eq('order_date', orderDateISO);

    handleError(res.error, 'Error al cargar pedidos del día.');
    state.ordersEffective = res.data || [];
  }

  function renderOrderOptions() {
    const memberSelect = document.getElementById('memberSelect');
    const activeMembers = state.members
      .filter((m) => m.active !== false)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' }));

    console.log('fetched members for order form', activeMembers);

    fillSelect(memberSelect, activeMembers, 'Selecciona un miembro');
    console.log('number of options inserted into memberSelect', Math.max((memberSelect?.options?.length || 0) - 1, 0));
    fillSelect(
      document.getElementById('drinkSelect'),
      state.drinks.filter((d) => d.active !== false),
      'Selecciona bebida'
    );
    fillSelect(
      document.getElementById('foodSelect'),
      state.foods.filter((f) => f.active !== false),
      'Selecciona comida'
    );

    applyCutoffState();
  }

  function fillSelect(select, items, placeholder) {
    if (!select) {
      console.error('fillSelect: missing select element', { placeholder });
      return;
    }

    select.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = placeholder;
    select.appendChild(defaultOption);

    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    });
  }

  function setupOrderForm() {
    const orderForm = document.getElementById('orderForm');
    const memberSelect = document.getElementById('memberSelect');
    const yesFields = document.getElementById('yesFields');
    const saveButton = document.getElementById('saveOrderBtn');

    orderForm.addEventListener('change', async (e) => {
      if (e.target.name === 'desayuna') {
        yesFields.classList.toggle('hidden', e.target.value !== 'si');
      }
      if (e.target.id === 'memberSelect') {
        await loadExistingOrderForMember();
      }
    });

    memberSelect.addEventListener('change', loadExistingOrderForMember);

    orderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage('orderMsg');

      if (state.schedule?.mode === 'blocked') {
        showMessage('orderMsg', getBlockedMessage(), 'error');
        return;
      }

      const memberId = parseMemberId(memberSelect.value);
      if (!memberId) {
        showMessage('orderMsg', 'Selecciona un miembro.', 'error');
        return;
      }

      const desayunaValue = orderForm.querySelector('input[name="desayuna"]:checked')?.value;
      if (!desayunaValue) {
        showMessage('orderMsg', 'Indica si desayunas hoy.', 'error');
        return;
      }

      const payload = {
        member_id: memberId,
        order_date: state.schedule.orderDateISO,
        desayuna: desayunaValue === 'si',
        drink_option_id: null,
        food_option_id: null,
        notes: null,
      };

      if (desayunaValue === 'si') {
        const drinkId = Number(document.getElementById('drinkSelect').value);
        const foodId = Number(document.getElementById('foodSelect').value);
        if (!drinkId || !foodId) {
          showMessage('orderMsg', 'Selecciona bebida y comida.', 'error');
          return;
        }
        payload.drink_option_id = drinkId;
        payload.food_option_id = foodId;
        payload.notes = document.getElementById('notesInput').value.trim() || null;
      }

      const existing = state.ordersEffective.find((o) => String(o.member_id) === String(memberId));
      let res;
      if (existing) {
        res = await supabase.from('orders').update(payload).eq('id', existing.id);
      } else {
        res = await supabase.from('orders').insert(payload);
      }

      if (res.error) {
        showMessage('orderMsg', `Error al guardar: ${res.error.message}`, 'error');
        return;
      }

      if (desayunaValue === 'si') {
        const habitualRes = await supabase
          .from('members')
          .update({
            habitual_drink_option_id: payload.drink_option_id,
            habitual_food_option_id: payload.food_option_id,
            habitual_notes: payload.notes,
          })
          .eq('id', memberId);

        if (habitualRes.error) {
          showMessage('orderMsg', `Error al guardar habitual: ${habitualRes.error.message}`, 'error');
          return;
        }
      }

      await loadOrdersForDate(state.schedule.orderDateISO);
      showMessage('orderMsg', 'Pedido guardado correctamente.', 'success');
      saveButton.blur();
    });
  }

  async function loadExistingOrderForMember() {
    const memberSelect = document.getElementById('memberSelect');
    const selectedMemberValue = memberSelect.value;
    const memberId = parseMemberId(selectedMemberValue);
    const orderForm = document.getElementById('orderForm');
    const yesFields = document.getElementById('yesFields');

    orderForm.reset();
    memberSelect.value = selectedMemberValue;
    document.getElementById('orderDate').value = formatDateES(state.schedule.orderDateISO);
    yesFields.classList.add('hidden');
    updateDesayunaLegend();

    if (!memberId) return;

    const existing = state.ordersEffective.find((o) => String(o.member_id) === String(memberId));
    if (!existing) {
      const member = state.members.find((m) => String(m.id) === String(memberId));
      const habitualDrinkId = member?.habitual_drink_option_id;
      const habitualFoodId = member?.habitual_food_option_id;
      const habitualNotes = member?.habitual_notes || '';

      if (habitualDrinkId || habitualFoodId || habitualNotes) {
        const radio = orderForm.querySelector('input[name="desayuna"][value="si"]');
        if (radio) radio.checked = true;
        yesFields.classList.remove('hidden');
        document.getElementById('drinkSelect').value = String(habitualDrinkId || '');
        document.getElementById('foodSelect').value = String(habitualFoodId || '');
        document.getElementById('notesInput').value = habitualNotes;
      }

      return;
    }

    const desayunaValue = existing.desayuna ? 'si' : 'no';
    const radio = orderForm.querySelector(`input[name="desayuna"][value="${desayunaValue}"]`);
    if (radio) radio.checked = true;

    if (existing.desayuna) {
      yesFields.classList.remove('hidden');
      document.getElementById('drinkSelect').value = String(existing.drink_option_id || '');
      document.getElementById('foodSelect').value = String(existing.food_option_id || '');
      document.getElementById('notesInput').value = existing.notes || '';
    }

    memberSelect.value = String(memberId);
  }

  function applyCutoffState() {
    const disabled = state.schedule?.mode === 'blocked';
    const saveBtn = document.getElementById('saveOrderBtn');
    const cutoffMsg = document.getElementById('cutoffMsg');

    saveBtn.disabled = disabled;
    cutoffMsg.classList.toggle('hidden', !disabled);
    cutoffMsg.textContent = disabled ? getBlockedMessage() : '';
    setOrderFormDisabled(disabled);
    updateDesayunaLegend();
  }

  function setupPins() {
    document.getElementById('summaryPinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await verifyPinAndEnter(
        document.getElementById('summaryPinInput').value,
        'summaryPinMsg',
        async () => {
          await renderSummary();
          showView('summary');
        }
      );
    });

    document.getElementById('settingsPinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await verifyPinAndEnter(
        document.getElementById('settingsPinInput').value,
        'settingsPinMsg',
        async () => {
          await renderSettings();
          showView('settings');
        }
      );
    });

    document.getElementById('copyOrderBtn').addEventListener('click', copySummaryText);
  }

  async function verifyPinAndEnter(enteredPin, msgId, onSuccess) {
    clearMessage(msgId);
    const settingsRes = await supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (settingsRes.error || !settingsRes.data) {
      showMessage(msgId, 'Error cargando configuración', 'error');
      return;
    }

    const settings = settingsRes.data;
    console.log('Entered PIN:', enteredPin);
    console.log('DB PIN:', settings.pin_code);

    if (enteredPin.trim() !== String(settings.pin_code)) {
      showMessage(msgId, 'PIN incorrecto.', 'error');
      return;
    }
    await onSuccess();
  }

  async function renderSummary() {
    await loadBootData();
    document.getElementById('summaryTitle').textContent =
      state.schedule.summaryLabelType === 'tomorrow'
        ? 'Resumen del pedido para mañana'
        : 'Resumen del pedido para hoy';

    const activeMembers = state.members.filter((m) => m.active !== false);
    const byMember = new Map(state.ordersEffective.map((o) => [o.member_id, o]));
    const responses = activeMembers.filter((m) => byMember.has(m.id));
    const desayunan = responses.filter((m) => byMember.get(m.id).desayuna);
    const noDesayunan = responses.filter((m) => !byMember.get(m.id).desayuna);

    const drinkCount = aggregateCount(
      desayunan
        .map((m) => state.drinks.find((d) => d.id === byMember.get(m.id).drink_option_id)?.name)
        .filter(Boolean)
    );

    const foodCount = aggregateCount(
      desayunan
        .map((m) => state.foods.find((f) => f.id === byMember.get(m.id).food_option_id)?.name)
        .filter(Boolean)
    );

    const detailItems = activeMembers
      .map((m) => {
        const order = byMember.get(m.id);
        if (!order) return `<li>${escapeHtml(m.name)} — pendiente</li>`;
        if (!order.desayuna) return `<li>${escapeHtml(m.name)} — no desayuna</li>`;

        const drink = state.drinks.find((d) => d.id === order.drink_option_id)?.name || 'Sin bebida';
        const food = state.foods.find((f) => f.id === order.food_option_id)?.name || 'Sin comida';
        const notes = order.notes ? ` (${escapeHtml(order.notes)})` : '';
        return `<li>${escapeHtml(m.name)} — desayuna — ${escapeHtml(drink)} + ${escapeHtml(food)}${notes}</li>`;
      })
      .join('');

    const summaryContent = document.getElementById('summaryContent');
    summaryContent.innerHTML = `
      <div class="summary-box">
        <strong>Fecha:</strong> ${formatDateES(state.schedule.summaryDateISO)}<br>
        <strong>Total miembros activos:</strong> ${activeMembers.length}<br>
        <strong>Respuestas recibidas:</strong> ${responses.length}<br>
        <strong>Pendientes:</strong> ${activeMembers.length - responses.length}<br>
        <strong>Desayunan:</strong> ${desayunan.length}<br>
        <strong>No desayunan:</strong> ${noDesayunan.length}
      </div>
      ${
        state.schedule.mode === 'blocked'
          ? `<p class="message warning">Franja de bloqueo. Entre las 09:30 y las 13:00 no se pueden realizar cambios.</p>`
          : ''
      }

      <div class="summary-box">
        <strong>Conteo bebidas</strong>
        <ul>${toCountList(drinkCount)}</ul>
      </div>

      <div class="summary-box">
        <strong>Conteo comidas</strong>
        <ul>${toCountList(foodCount)}</ul>
      </div>

      <div class="summary-box">
        <strong>Detalle</strong>
        <ul>${detailItems}</ul>
      </div>
    `;
  }

  function toCountList(map) {
    const entries = Object.entries(map);
    if (!entries.length) return '<li>Sin datos</li>';
    return entries.map(([name, count]) => `<li>${count} ${escapeHtml(name)}</li>`).join('');
  }

  function aggregateCount(list) {
    return list.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});
  }

  async function copySummaryText() {
    await loadBootData();
    const byMember = new Map(state.ordersEffective.map((o) => [o.member_id, o]));
    const activeMembers = state.members.filter((m) => m.active !== false);
    const desayunanOrders = activeMembers
      .map((m) => byMember.get(m.id))
      .filter((o) => o && o.desayuna);

    const drinkCount = aggregateCount(
      desayunanOrders
        .map((o) => state.drinks.find((d) => d.id === o.drink_option_id)?.name)
        .filter(Boolean)
    );
    const foodCount = aggregateCount(
      desayunanOrders
        .map((o) => state.foods.find((f) => f.id === o.food_option_id)?.name)
        .filter(Boolean)
    );

    const lines = [
      `Pedido desayuno equipo — ${formatDateES(state.schedule.summaryDateISO)}`,
      'Bebidas:',
      ...Object.entries(drinkCount).map(([name, count]) => `- ${count} ${name}`),
      'Comidas:',
      ...Object.entries(foodCount).map(([name, count]) => `- ${count} ${name}`),
    ];

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showMessage('copyMsg', 'Pedido copiado al portapapeles.', 'success');
    } catch {
      showMessage('copyMsg', 'No se pudo copiar automáticamente.', 'error');
    }
  }

  function setupSettings() {
    document.getElementById('memberForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await addSimpleItem('members', document.getElementById('newMemberName'));
      await renderSettings();
    });

    document.getElementById('drinkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await addSimpleItem('drink_options', document.getElementById('newDrinkName'));
      await renderSettings();
    });

    document.getElementById('foodForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await addSimpleItem('food_options', document.getElementById('newFoodName'));
      await renderSettings();
    });

    document.getElementById('saveCoordinatorBtn').addEventListener('click', async () => {
      const authorized = document.getElementById('coordinatorToggle').checked;
      const res = await supabase
        .from('settings')
        .update({ coordinator_authorized: authorized })
        .eq('id', state.settings.id);
      if (res.error) {
        showMessage('settingsMsg', `Error: ${res.error.message}`, 'error');
        return;
      }
      showMessage('settingsMsg', 'Coordinadores actualizado.', 'success');
      await loadBootData();
    });

    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      const pin = document.getElementById('pinSettingInput').value.trim();
      const currentDayCutoff = document.getElementById('currentDayCutoffInput').value;
      const nextDayOpening = document.getElementById('nextDayOpeningInput').value;
      const payload = {
        pin: pin || state.settings.pin,
        current_day_cutoff: currentDayCutoff || state.settings.current_day_cutoff || '09:30',
        next_day_opening: nextDayOpening || state.settings.next_day_opening || '13:00',
      };
      const res = await supabase.from('settings').update(payload).eq('id', state.settings.id);
      if (res.error) {
        showMessage('settingsMsg', `Error: ${res.error.message}`, 'error');
        return;
      }
      showMessage('settingsMsg', 'Ajustes guardados.', 'success');
      await loadBootData();
      applyCutoffState();
    });
  }

  async function addSimpleItem(table, inputEl) {
    const name = inputEl.value.trim();
    if (!name) return;
    const res = await supabase.from(table).insert({ name, active: true });
    if (res.error) {
      showMessage('settingsMsg', `Error: ${res.error.message}`, 'error');
      return;
    }
    inputEl.value = '';
    showMessage('settingsMsg', 'Elemento añadido.', 'success');
    await loadBootData();
    renderOrderOptions();
  }

  async function renderSettings() {
    await loadBootData();
    renderEditableList('membersList', state.members, 'members');
    renderEditableList('drinksList', state.drinks, 'drink_options');
    renderEditableList('foodsList', state.foods, 'food_options');

    document.getElementById('coordinatorToggle').checked = !!state.settings?.coordinator_authorized;
    document.getElementById('pinSettingInput').value = state.settings?.pin || '';
    document.getElementById('currentDayCutoffInput').value = state.settings?.current_day_cutoff || '09:30';
    document.getElementById('nextDayOpeningInput').value = state.settings?.next_day_opening || '13:00';
  }

  function renderEditableList(containerId, items, table) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.innerHTML = `
        <input type="text" value="${escapeHtml(item.name || '')}" />
        <button class="btn btn-secondary" type="button">${item.active === false ? 'Activar' : 'Desactivar'}</button>
        <button class="btn" type="button">Guardar</button>
      `;

      const [nameInput, toggleBtn, saveBtn] = row.querySelectorAll('input, button');

      toggleBtn.addEventListener('click', async () => {
        const res = await supabase
          .from(table)
          .update({ active: item.active === false })
          .eq('id', item.id);
        if (res.error) {
          showMessage('settingsMsg', `Error: ${res.error.message}`, 'error');
          return;
        }
        await renderSettings();
        renderOrderOptions();
      });

      saveBtn.addEventListener('click', async () => {
        const res = await supabase
          .from(table)
          .update({ name: nameInput.value.trim() || item.name })
          .eq('id', item.id);
        if (res.error) {
          showMessage('settingsMsg', `Error: ${res.error.message}`, 'error');
          return;
        }
        showMessage('settingsMsg', 'Nombre actualizado.', 'success');
        await renderSettings();
        renderOrderOptions();
      });

      container.appendChild(row);
    });
  }

  function handleError(error, friendlyText) {
    if (error) {
      console.error(error);
      alert(`${friendlyText} (${error.message})`);
    }
  }

  function showMessage(id, text, type = '') {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `message ${type}`;
    el.classList.remove('hidden');
  }

  function clearMessage(id) {
    const el = document.getElementById(id);
    el.className = 'message hidden';
    el.textContent = '';
  }

  function getSpainNow() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const isoDate = `${value.year}-${value.month}-${value.day}`;
    const hours = Number(value.hour);
    const minutes = Number(value.minute);
    return {
      isoDate,
      time: `${value.hour}:${value.minute}`,
      minutesOfDay: (hours * 60) + minutes,
    };
  }

  function getEffectiveSchedule(settings) {
    const nowSpain = getSpainNow();
    const todayISO = nowSpain.isoDate;
    const tomorrowISO = addDaysToISO(todayISO, 1);
    const currentDayCutoff = settings?.current_day_cutoff || '09:30';
    const nextDayOpening = settings?.next_day_opening || '13:00';
    const cutoffMinutes = timeToMinutes(currentDayCutoff);
    const openingMinutes = timeToMinutes(nextDayOpening);

    if (nowSpain.minutesOfDay < cutoffMinutes) {
      return {
        mode: 'today',
        orderDateISO: todayISO,
        summaryDateISO: todayISO,
        summaryLabelType: 'today',
      };
    }

    if (nowSpain.minutesOfDay < openingMinutes) {
      return {
        mode: 'blocked',
        orderDateISO: todayISO,
        summaryDateISO: todayISO,
        summaryLabelType: 'today',
      };
    }

    return {
      mode: 'tomorrow',
      orderDateISO: tomorrowISO,
      summaryDateISO: tomorrowISO,
      summaryLabelType: 'tomorrow',
    };
  }

  function addDaysToISO(isoDate, days) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    const outYear = date.getUTCFullYear();
    const outMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const outDay = String(date.getUTCDate()).padStart(2, '0');
    return `${outYear}-${outMonth}-${outDay}`;
  }

  function timeToMinutes(timeValue) {
    const [h, m] = String(timeValue || '00:00').split(':').map(Number);
    return (h * 60) + (m || 0);
  }

  function renderScheduleUI() {
    const titleLabel = state.schedule?.mode === 'tomorrow' ? 'Pedido para mañana' : 'Pedido para hoy';
    document.getElementById('todayLabel').textContent = titleLabel;
    document.getElementById('orderWindowLabel').textContent = `Fecha efectiva: ${formatDateES(state.schedule.orderDateISO)}`;
    document.getElementById('orderDate').value = formatDateES(state.schedule.orderDateISO);
    applyCutoffState();
  }

  function getBlockedMessage() {
    return 'Entre las 09:30 y las 13:00 no se pueden modificar pedidos. A partir de las 13:00 se habilita el pedido del día siguiente.';
  }

  function setOrderFormDisabled(disabled) {
    const controls = document.querySelectorAll('#orderForm input, #orderForm select, #orderForm textarea');
    controls.forEach((control) => {
      if (control.id === 'orderDate') return;
      control.disabled = disabled;
    });
  }

  function parseMemberId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return /^\d+$/.test(raw) ? Number(raw) : raw;
  }

  function updateDesayunaLegend() {
    const text = state.schedule?.mode === 'tomorrow' ? '¿Desayunas mañana?' : '¿Desayunas hoy?';
    document.getElementById('desayunaLegend').textContent = text;
  }

  function formatDateES(isoDate) {
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
