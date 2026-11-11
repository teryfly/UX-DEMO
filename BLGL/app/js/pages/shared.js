/* ============================================================
   页面共享：病历详情全屏页、提交归档流程、归档结果反馈
   ============================================================ */
const Shared = (() => {
  const F = window.FHIR, U = window.UI, B = window.Biz, E = window.EMR;
  const esc = U.esc;

  // 提交归档：执行终末质控，弹出结果。结果弹框的按钮统一通过 m.close() 关闭，
  // 避免直接操作 DOM 节点导致的绑定失效（修复"点击完成按钮无效"问题）。
  function doSubmitArchive(enc, onDone) {
    const res = B.submitArchive(enc);
    if (res.blocked) { U.toast(res.reason, 'warn', 3200); onDone && onDone(); return; }
    if (res.intercepted) {
      const m = U.modal({ title: '归档结果 — 已拦截', width: 'w560',
        body: `<div class="banner danger">⛔ 终末质控发现严重问题，已拦截归档</div>
          <div class="sec-title">质控发现的问题</div>
          ${res.issues.map(i => `<div style="padding:8px 0;border-bottom:1px solid var(--c-line)"><b>${esc(i.location)}</b><div class="muted" style="font-size:13px">${esc(i.desc)}</div><div style="font-size:13px;color:var(--c-primary)">整改要求：${esc(i.requirement)}</div></div>`).join('')}
          <div class="wrap-note">系统已自动生成整改任务并通知责任医生，可在「整改任务处理」中完成整改后重新提交。</div>`,
        footer: `<button class="btn pri ok">我知道了</button>` });
      m.el.querySelector('.ok').onclick = () => { m.close(); onDone && onDone(); };
    } else {
      const m = U.modal({ title: '归档结果 — 归档成功', width: 'w560',
        body: `<div class="banner ok">✅ 终末质控通过，病历已归档</div>
          <div class="kv"><b>病历编号</b><span>${esc(res.blNo)}</span><b>患者</b><span>${esc(enc.patientName)}</span>
          <b>归档时间</b><span>${F.fmt(enc.archivedAt)}</span><b>同步状态</b><span class="pill green">已同步至病历归档系统</span></div>`,
        footer: `<button class="btn pri ok">完成</button>` });
      m.el.querySelector('.ok').onclick = () => { m.close(); onDone && onDone(); };
    }
  }

  // 病历详情：全屏页面（编辑 / 只读），用「← 返回」返回上一级列表
  function emrModal(encId, { mode = 'view', onDone, focusDoc } = {}) {
    const enc = F.byId('Encounter', encId);
    const readonly = mode === 'view' || enc.archiveStatus === 'archived';
    const editor = E.build(encId, { readonly, focusDoc });
    const tasks = B.tasksOf(encId).filter(t => t.status === '待整改');
    const sumOver = B.encSummary(enc).over;
    let banner = '';
    if (tasks.length) banner = `<div class="banner warn">⚠️ 待整改 ${tasks.length} 项：` +
      tasks.map((t, i) => `${'①②③④⑤'[i] || (i + 1)} ${esc(t.location)}（${esc(t.source)}）截止 ${F.mdhm(t.dueAt)}`).join('；') + `</div>`;
    else if (sumOver) banner = `<div class="banner warn">⚠️ 时限预警：该患者有 ${sumOver} 项文书已超时，请尽快完成书写</div>`;

    const body = U.h(`<div>${banner}<div class="emr-host"></div></div>`);
    body.querySelector('.emr-host').appendChild(editor.el);
    const footer = readonly ? `<button class="btn pri close">关闭</button>`
      : `<span class="muted" style="margin-right:auto;font-size:12px">💾 系统每 60 秒自动保存并触发整改复核</span><button class="btn close">关闭</button><button class="btn save">保存</button><button class="btn pri arch">提交归档</button>`;
    let autosaveTimer = null;
    const m = U.fullpage({ title: `病历详情 — ${enc.patientName}`, subtitle: `${F.orgName(enc.org)} / ${enc.bed || '—'} · ${enc.mrn}`, body, footer,
      onClose: () => { if (autosaveTimer) clearInterval(autosaveTimer); onDone && onDone(); } });
    m.el.querySelector('.close').onclick = m.close;
    function refreshBanner() {
      const left = B.tasksOf(encId).filter(t => t.status === '待整改');
      const b = m.body.querySelector('.banner');
      if (b) { if (!left.length) { b.className = 'banner ok'; b.textContent = '✅ 该患者整改任务已全部完成，可提交归档'; } else b.innerHTML = '⚠️ 待整改 ' + left.length + ' 项，请继续整改'; }
    }
    if (!readonly) {
      const doSave = (silent) => {
        const fixed = editor.commitDraft();
        editor.refresh();
        if (!silent) U.toast(fixed ? `已保存，自动复核通过 ${fixed} 项整改` : '已保存', 'ok');
        else if (fixed) U.toast(`自动保存：复核通过 ${fixed} 项整改`, 'info');
        refreshBanner();
      };
      m.el.querySelector('.save').onclick = () => doSave(false);
      autosaveTimer = setInterval(() => { if (document.body.contains(m.el)) doSave(true); }, 60000);
      m.el.querySelector('.arch').onclick = () => {
        editor.commitDraft();
        const pending = B.tasksOf(encId).filter(t => t.status === '待整改');
        if (pending.length) { U.toast('仍有未完成的整改任务，无法提交归档', 'warn'); return; }
        doSubmitArchive(enc, () => { m.close(); });
      };
    }
    return m;
  }

  return { emrModal, doSubmitArchive };
})();
window.Shared = Shared;
