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
    ordersToday: [],
  };

  const views = {
    home: document.getElementById('view-home'),
    order: document.getElementById('view-order'),
    'summary-pin': document.getElementById('view-summary-pin'),
    summary: document.getElementById('view-summary'),
    'settings-pin': document.getElementById('view-settings-pin'),
    settings: document.getElementById('view-settings'),
  };

  const todayISO = getTodayISO();
  document.getElementById('todayLabel').textContent = formatDateES(todayISO);
  document.getElementById('orderDate').value = formatDateES(todayISO);

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

    await loadTodayOrders();
  }

  async function loadTodayOrders() {
    const res = await supabase
      .from('orders')
      .select('*')
      .eq('order_date', todayISO);

    handleError(res.error, 'Error al cargar pedidos del día.');
    state.ordersToday = res.data || [];
  }

  function renderOrderOptions() {
    fillSelect(
      document.getElementById('memberSelect'),
      state.members.filter((m) => m.active !== false),
      'Selecciona un miembro'
    );
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

      if (isPastCutoff()) {
        showMessage('orderMsg', 'Ya ha pasado la hora límite. No se puede guardar.', 'error');
        return;
      }

      const memberId = Number(memberSelect.value);
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
        order_date: todayISO,
        desayuna: desayunaValue === 'si',
        drink_option_id: null,
        food_option_id: null,
        observations: null,
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
        payload.observations = document.getElementById('notesInput').value.trim() || null;
      }

      const existing = state.ordersToday.find((o) => o.member_id === memberId);
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

      await loadTodayOrders();
      showMessage('orderMsg', 'Pedido guardado correctamente.', 'success');
      saveButton.blur();
    });
  }

  async function loadExistingOrderForMember() {
    const memberId = Number(document.getElementById('memberSelect').value);
    const orderForm = document.getElementById('orderForm');
    const yesFields = document.getElementById('yesFields');

    orderForm.reset();
    document.getElementById('orderDate').value = formatDateES(todayISO);
    yesFields.classList.add('hidden');

    if (!memberId) return;

    const existing = state.ordersToday.find((o) => o.member_id === memberId);
    if (!existing) return;

    const desayunaValue = existing.desayuna ? 'si' : 'no';
    const radio = orderForm.querySelector(`input[name="desayuna"][value="${desayunaValue}"]`);
    if (radio) radio.checked = true;

    if (existing.desayuna) {
      yesFields.classList.remove('hidden');
      document.getElementById('drinkSelect').value = String(existing.drink_option_id || '');
      document.getElementById('foodSelect').value = String(existing.food_option_id || '');
      document.getElementById('notesInput').value = existing.observations || '';
    }

    document.getElementById('memberSelect').value = String(memberId);
  }

  function isPastCutoff() {
    const cutoff = state.settings?.cutoff_time;
    if (!cutoff) return false;
    const now = new Date();
    const [h, m] = cutoff.split(':').map(Number);
    const cutoffDate = new Date();
    cutoffDate.setHours(h, m || 0, 0, 0);
    return now > cutoffDate;
  }

  function applyCutoffState() {
    const disabled = isPastCutoff();
    const saveBtn = document.getElementById('saveOrderBtn');
    const cutoffMsg = document.getElementById('cutoffMsg');

    saveBtn.disabled = disabled;
    cutoffMsg.classList.toggle('hidden', !disabled);
    cutoffMsg.textContent = disabled
      ? `Hora límite superada (${state.settings?.cutoff_time || '--:--'}).`
      : '';
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

  async function verifyPinAndEnter(inputPin, msgId, onSuccess) {
    clearMessage(msgId);
    await loadBootData();
    if (String(inputPin).trim() !== String(state.settings?.pin || '')) {
      showMessage(msgId, 'PIN incorrecto.', 'error');
      return;
    }
    await onSuccess();
  }

  async function renderSummary() {
    await loadBootData();

    const activeMembers = state.members.filter((m) => m.active !== false);
    const byMember = new Map(state.ordersToday.map((o) => [o.member_id, o]));
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
        const notes = order.observations ? ` (${escapeHtml(order.observations)})` : '';
        return `<li>${escapeHtml(m.name)} — desayuna — ${escapeHtml(drink)} + ${escapeHtml(food)}${notes}</li>`;
      })
      .join('');

    const summaryContent = document.getElementById('summaryContent');
    summaryContent.innerHTML = `
      <div class="summary-box">
        <strong>Fecha:</strong> ${formatDateES(todayISO)}<br>
        <strong>Total miembros activos:</strong> ${activeMembers.length}<br>
        <strong>Respuestas recibidas:</strong> ${responses.length}<br>
        <strong>Pendientes:</strong> ${activeMembers.length - responses.length}<br>
        <strong>Desayunan:</strong> ${desayunan.length}<br>
        <strong>No desayunan:</strong> ${noDesayunan.length}
      </div>

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
    const byMember = new Map(state.ordersToday.map((o) => [o.member_id, o]));
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
      `Pedido desayuno equipo — ${formatDateES(todayISO)}`,
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
      const cutoff = document.getElementById('cutoffInput').value;
      const payload = {
        pin: pin || state.settings.pin,
        cutoff_time: cutoff || state.settings.cutoff_time,
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
    document.getElementById('cutoffInput').value = state.settings?.cutoff_time || '';
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

  function getTodayISO() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
