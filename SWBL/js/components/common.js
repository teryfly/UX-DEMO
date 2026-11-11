/* =====================================================================
 * components/common.js —— 通用组件库（IX-3.2）
 * 弹窗/抽屉/确认框/分页/标签/步骤条/时间线/进度条/空状态/骨架屏/图表等，
 * 全部零依赖实现（div + SVG），配色遵循 IX-3.4。
 * ===================================================================== */
(function (global) {
  'use strict';
  var D = global.Domain, C = global.AMS.components;

  /* 弹窗 */
  C['ui-modal'] = {
    props: { title: String, width: { type: String, default: '' }, icon: String },
    emits: ['close'],
    template: `
      <div class="modal-mask" @click.self="$emit('close')">
        <div class="modal" :class="width">
          <div class="modal-head">
            <h3><span v-if="icon">{{ icon }} </span>{{ title }}</h3>
            <button class="x" @click="$emit('close')" title="关闭">✕</button>
          </div>
          <div class="modal-body"><slot></slot></div>
          <div class="modal-foot" v-if="$slots.foot"><slot name="foot"></slot></div>
        </div>
      </div>`
  };

  /* 抽屉（向右滑出，如报表查看） */
  C['ui-drawer'] = {
    props: { title: String, width: { type: String, default: '' } },
    emits: ['close'],
    template: `
      <div class="drawer-mask" @click.self="$emit('close')">
        <div class="drawer" :class="width">
          <div class="drawer-head">
            <h3>{{ title }}</h3>
            <button class="x" style="border:0;background:none;font-size:18px;cursor:pointer;color:#8C8C8C" @click="$emit('close')">✕</button>
          </div>
          <div class="drawer-body"><slot></slot></div>
          <div class="drawer-foot" v-if="$slots.foot"><slot name="foot"></slot></div>
        </div>
      </div>`
  };

  /* 分页（默认每页 20，可切 10/20/50） */
  C['ui-pager'] = {
    props: { total: Number, page: { type: Number, default: 1 }, size: { type: Number, default: 20 }, sizes: { type: Array, default: function () { return [10, 20, 50]; } } },
    emits: ['update:page', 'update:size'],
    computed: {
      pages: function () { return Math.max(1, Math.ceil(this.total / (this.size || 20))); },
      list: function () {
        var p = this.page, n = this.pages, out = [];
        if (n <= 7) { for (var i = 1; i <= n; i++) out.push(i); return out; }
        out.push(1);
        var s = Math.max(2, p - 1), e = Math.min(n - 1, p + 1);
        if (s > 2) out.push('…');
        for (var k = s; k <= e; k++) out.push(k);
        if (e < n - 1) out.push('…');
        out.push(n);
        return out;
      }
    },
    template: `
      <div class="pager">
        <span>共 <b>{{ total }}</b> 条</span>
        <span>每页
          <select style="width:auto;padding:2px 6px" :value="size" @change="$emit('update:size', +$event.target.value)">
            <option v-for="s in sizes" :value="s">{{ s }}</option>
          </select> 条
        </span>
        <div class="pages">
          <button class="pg" :disabled="page<=1" @click="$emit('update:page', page-1)">‹ 上一页</button>
          <template v-for="(p,i) in list">
            <span v-if="p==='…'" class="ellipsis" :key="'e'+i">…</span>
            <button v-else class="pg" :class="{active:p===page}" :key="p" @click="$emit('update:page', p)">{{ p }}</button>
          </template>
          <button class="pg" :disabled="page>=pages" @click="$emit('update:page', page+1)">下一页 ›</button>
        </div>
      </div>`
  };

  /* 字典标签：按 Domain 枚举表着色 */
  C['dict-tag'] = {
    props: { list: Array, value: [String, Number], icon: { type: Boolean, default: true }, big: Boolean },
    computed: {
      item: function () { return (this.list || []).filter(function (x) { return x.code === this.value; }, this)[0] || null; },
      cls: function () { return this.item ? (this.item.cls || 'gray') : 'gray'; },
      text: function () { return this.item ? this.item.name : (this.value == null || this.value === '' ? '—' : String(this.value)); },
      ic: function () { return this.icon && this.item && this.item.icon ? this.item.icon + ' ' : ''; }
    },
    template: `<span class="tag" :class="[cls, big?'big':'']">{{ ic }}{{ text }}</span>`
  };

  /* 倒计时文本（绿/黄/橙/红 + 已超时） */
  C['countdown-text'] = {
    props: { cd: Object, showDeadline: Boolean },
    computed: {
      text: function () { return this.cd ? this.cd.text : '—'; },
      cls: function () { return this.cd ? this.cd.level : 'normal'; }
    },
    template: `
      <span>
        <span class="countdown" :class="cls">{{ text }}</span>
        <span v-if="showDeadline && cd && cd.deadline" class="muted small">（截止 {{ fmt(cd.deadline) }}）</span>
      </span>`,
    methods: { fmt: function (ms) { return global.Limit.dt(ms); } }
  };

  /* 空状态 */
  C['empty-state'] = {
    props: { text: { type: String, default: '暂无数据' }, icon: { type: String, default: '📭' }, sub: String },
    template: `
      <div class="empty">
        <span class="pic">{{ icon }}</span>
        <p>{{ text }}</p>
        <p class="sub" v-if="sub">{{ sub }}</p>
        <div class="mt8" v-if="$slots.default"><slot></slot></div>
      </div>`
  };

  /* 骨架屏 */
  C['skeleton-block'] = {
    props: { rows: { type: Number, default: 4 }, card: Boolean },
    template: `
      <div>
        <div v-if="card" class="skeleton card mb12"></div>
        <div v-for="i in rows" :key="i" class="skeleton" :style="{width: (100 - i*7) + '%'}"></div>
      </div>`
  };

  /* 步骤条 */
  C['steps-bar'] = {
    props: { steps: Array, small: Boolean },
    template: `
      <div class="steps" :class="{small: small}">
        <div v-for="(s,i) in steps" :key="s.key || i" class="step" :class="s.state">
          <div class="bar"></div>
          <div class="dot">{{ s.state==='done' ? '✓' : (s.state==='rejected' ? '✕' : (i+1)) }}</div>
          <div class="s-name">{{ s.name }}</div>
          <div class="s-meta">{{ s.actor || '' }}{{ s.at ? (' ' + shortAt(s.at)) : '' }}</div>
        </div>
      </div>`,
    methods: {
      shortAt: function (v) {
        if (!v) return '';
        var s = String(v);
        return s.length >= 16 ? s.slice(5, 16) : s.slice(5);
      }
    }
  };

  /* 时间线 */
  C['timeline-list'] = {
    props: { items: Array, plain: Boolean },
    template: `
      <div class="timeline">
        <div v-for="(it,i) in items" :key="i" class="tl-item" :class="it.level || 'gray'">
          <div class="tl-head">
            <span class="who">{{ it.title }}</span>
            <span v-if="it.tag" class="tag" :class="it.tagCls || 'gray'">{{ it.tag }}</span>
            <span class="at">{{ it.at }}</span>
            <span class="spacer"></span>
            <slot name="action" :item="it"></slot>
          </div>
          <div class="tl-body" :class="{plain: plain}" v-if="it.text">{{ it.text }}</div>
          <div v-if="it.files && it.files.length" class="mt4">
            <a v-for="(f,j) in it.files" :key="j" class="small" style="margin-right:10px">📎 {{ f.name }}（{{ f.size }}）</a>
          </div>
        </div>
      </div>`
  };

  /* 进度条 */
  C['progress-bar'] = {
    props: { value: { type: Number, default: 0 }, kind: { type: String, default: '' }, thin: Boolean, showText: { type: Boolean, default: true } },
    template: `
      <div class="progress-row">
        <div class="progress" :class="[kind, {thin: thin}]"><i :style="{width: Math.max(0, Math.min(100, value)) + '%'}"></i></div>
        <span class="pct" v-if="showText">{{ value }}%</span>
      </div>`
  };

  /* 键值对 */
  C['kv-grid'] = {
    props: { rows: Array, cols: { type: Number, default: 2 } },
    template: `
      <div class="kv" :class="cols===3?'cols-3':''">
        <div v-for="(r,i) in rows" :key="i">
          <span class="k">{{ r[0] }}</span><span class="v" :class="r[2]">{{ r[1] == null || r[1] === '' ? '——' : r[1] }}</span>
        </div>
      </div>`
  };

  /* 竖向柱状图 */
  C['bar-chart'] = {
    props: { data: Array, height: { type: Number, default: 168 }, unit: { type: String, default: '' } },
    computed: {
      max: function () { return Math.max.apply(null, (this.data || []).map(function (d) { return d.value || 0; }).concat([1])); }
    },
    template: `
      <div v-if="data && data.length" class="bar-chart" :style="{height: height+'px'}">
        <div class="bc" v-for="(d,i) in data" :key="i" :title="d.label + '：' + d.value + unit">
          <div class="bar" :style="{height: Math.max(2, (d.value/max)*100) + '%'}"><span>{{ d.value }}{{ unit }}</span></div>
          <div class="x">{{ d.label }}</div>
        </div>
      </div>
      <empty-state v-else text="暂无统计数据" icon="📊"></empty-state>`
  };

  /* 横向条形图（排行） */
  C['hbar-chart'] = {
    props: { data: Array, unit: { type: String, default: '' }, kind: { type: String, default: '' }, width: { type: Number, default: 150 }, showPct: Boolean },
    computed: { max: function () { return Math.max.apply(null, (this.data || []).map(function (d) { return d.value || 0; }).concat([1])); } },
    template: `
      <div v-if="data && data.length">
        <div class="hbar" v-for="(d,i) in data" :key="i">
          <span class="nm" :style="{width: width+'px', flex:'0 0 auto'}" :title="d.label">{{ d.label }}</span>
          <span class="track"><span class="fill" :class="d.kind || kind" :style="{width: Math.max(1.5,(d.value/max)*100)+'%'}"></span></span>
          <span class="val">{{ d.value }}{{ unit }}<template v-if="d.pct!==undefined && d.pct!==null">（{{ d.pct }}%）</template></span>
          <slot name="after" :item="d"></slot>
        </div>
      </div>
      <empty-state v-else text="暂无统计数据" icon="📊"></empty-state>`
  };

  /* 排行榜列表 */
  C['rank-list'] = {
    props: { items: Array, unit: { type: String, default: '例' } },
    template: `
      <ul class="rank-list" v-if="items && items.length">
        <li v-for="(it,i) in items" :key="i">
          <span class="idx" :class="i<3?('top'+(i+1)):''">{{ i+1 }}</span>
          <span class="nm" :title="it.label">{{ it.label }}</span>
          <span class="n">{{ it.value }}{{ unit }}</span>
          <span class="muted small" style="width:52px;text-align:right">{{ it.pct != null ? it.pct + '%' : '' }}</span>
          <slot name="after" :item="it"></slot>
        </li>
      </ul>
      <empty-state v-else text="暂无统计数据" icon="📊"></empty-state>`
  };

  /* 折线图（多条 + 图例勾选 + hover 数值） */
  C['line-chart'] = {
    props: {
      series: Array,           // [{key,name,color,points:[{label,value}]}]
      height: { type: Number, default: 200 },
      unit: { type: String, default: '' },
      selectable: { type: Boolean, default: false },
      hidden: { type: Array, default: function () { return []; } }
    },
    emits: ['toggle'],
    data: function () { return { hover: null }; },
    computed: {
      W: function () { return 640; },
      H: function () { return this.height; },
      visible: function () {
        var h = this.hidden || [];
        return (this.series || []).filter(function (s) { return h.indexOf(s.key) < 0; });
      },
      labels: function () { return (this.series && this.series[0] && this.series[0].points.length) ? this.series[0].points.map(function (p) { return p.label; }) : []; },
      max: function () {
        var m = 0;
        this.visible.forEach(function (s) { s.points.forEach(function (p) { if ((p.value || 0) > m) m = p.value; }); });
        return m || 1;
      },
      paths: function () {
        var self = this, n = this.labels.length || 1;
        var pad = 30;
        return this.visible.map(function (s) {
          var pts = s.points.map(function (p, i) {
            var x = pad + (n === 1 ? 0 : (i * (self.W - pad * 2)) / (n - 1));
            var y = self.H - 26 - ((p.value || 0) / self.max) * (self.H - 46);
            return [x, y, p];
          });
          return { name: s.name, key: s.key, color: s.color, d: pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' '), pts: pts };
        });
      },
      gridY: function () {
        var out = [], self = this;
        for (var i = 0; i <= 4; i++) {
          out.push({ y: this.H - 26 - (i * (this.H - 46)) / 4, label: ((this.max * i) / 4).toFixed(this.max < 10 ? 1 : 0) + this.unit });
        }
        return out;
      }
    },
    methods: {
      tip: function (p) { return p[2].label + '：' + p[2].value + this.unit; },
      onHover: function (ev, s, p) { this.hover = { x: ev.offsetX, y: ev.offsetY, text: this.tip(p), color: s.color }; },
      onLeave: function () { this.hover = null; }
    },
    template: `
      <div v-if="series && series.length && labels.length">
        <div style="position:relative">
          <svg class="line-chart" :viewBox="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" :style="{height: H+'px'}">
            <g>
              <line v-for="(g,i) in gridY" :key="'g'+i" :x1="30" :x2="W-10" :y1="g.y" :y2="g.y" stroke="#F0F0F0" stroke-width="1"></line>
              <text v-for="(g,i) in gridY" :key="'t'+i" x="2" :y="g.y+4" font-size="10" fill="#8C8C8C">{{ g.label }}</text>
            </g>
            <g>
              <text v-for="(l,i) in labels" :key="'l'+i" :x="30 + (labels.length===1?0:i*(W-60)/(labels.length-1))" :y="H-8"
                    font-size="10" fill="#8C8C8C" text-anchor="middle">{{ l }}</text>
            </g>
            <g v-for="s in paths" :key="s.key">
              <path :d="s.d" fill="none" :stroke="s.color" stroke-width="2" stroke-linejoin="round"></path>
              <circle v-for="(p,i) in s.pts" :key="i" :cx="p[0]" :cy="p[1]" r="3" :fill="s.color"
                      @mousemove="onHover($event,s,p)" @mouseleave="onLeave"></circle>
            </g>
          </svg>
          <div v-if="hover" :style="{position:'absolute', left: Math.min(W-140, hover.x)+'px', top: Math.max(0, hover.y-30)+'px', background:'rgba(0,0,0,.78)', color:'#fff', fontSize:'11.5px', padding:'3px 8px', borderRadius:'4px', pointerEvents:'none', whiteSpace:'nowrap'}">{{ hover.text }}</div>
        </div>
        <div class="lc-legend">
          <label v-for="s in series" :key="s.key">
            <input v-if="selectable" type="checkbox" :checked="hidden.indexOf(s.key)<0" @change="$emit('toggle', s.key)">
            <span class="k" :style="{background: s.color}"></span>{{ s.name }}
          </label>
        </div>
      </div>
      <empty-state v-else text="暂无统计数据" icon="📈"></empty-state>`
  };

  /* 饼图 / 环形图 */
  C['pie-chart'] = {
    props: { data: Array, donut: { type: Boolean, default: true }, size: { type: Number, default: 168 }, unit: { type: String, default: '例' } },
    computed: {
      total: function () { return (this.data || []).reduce(function (a, b) { return a + (b.value || 0); }, 0); },
      arcs: function () {
        var self = this, r = this.size / 2 - 4, cx = this.size / 2, cy = this.size / 2, start = -Math.PI / 2;
        var colors = ['#1890FF', '#FF4D4F', '#FAAD14', '#52C41A', '#722ED1', '#13C2C2', '#FA8C16', '#BFBFBF'];
        if (!this.total) return [];
        return this.data.map(function (d, i) {
          var ang = (d.value / self.total) * Math.PI * 2;
          var end = start + ang;
          var large = ang > Math.PI ? 1 : 0;
          var path = 'M ' + cx + ' ' + cy + ' L ' + (cx + r * Math.cos(start)) + ' ' + (cy + r * Math.sin(start)) +
            ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(end)) + ' ' + (cy + r * Math.sin(end)) + ' Z';
          var item = { d: path, color: d.color || colors[i % colors.length], label: d.label, value: d.value, pct: +(d.value / self.total * 100).toFixed(1) };
          start = end;
          return item;
        });
      }
    },
    template: `
      <div class="donut-wrap" v-if="data && data.length && total">
        <svg :width="size" :height="size" :viewBox="'0 0 ' + size + ' ' + size" style="flex:0 0 auto">
          <path v-for="(a,i) in arcs" :key="i" :d="a.d" :fill="a.color" stroke="#fff" stroke-width="1.5">
            <title>{{ a.label }} {{ a.value }}{{ unit }}（{{ a.pct }}%）</title>
          </path>
          <circle v-if="donut" :cx="size/2" :cy="size/2" :r="size/2 - 30" fill="#fff"></circle>
          <text v-if="donut" :x="size/2" :y="size/2 - 2" text-anchor="middle" font-size="19" font-weight="600" fill="#262626">{{ total }}</text>
          <text v-if="donut" :x="size/2" :y="size/2 + 15" text-anchor="middle" font-size="11" fill="#8C8C8C">合计{{ unit }}</text>
        </svg>
        <ul class="pie-legend" style="flex:1;min-width:130px">
          <li v-for="(a,i) in arcs" :key="i">
            <span class="sw" :style="{background: a.color}"></span>
            <span>{{ a.label }}</span><span class="spacer" style="flex:1"></span>
            <b>{{ a.value }}{{ unit }}</b><span class="muted">（{{ a.pct }}%）</span>
          </li>
        </ul>
      </div>
      <empty-state v-else text="暂无统计数据" icon="🥧"></empty-state>`
  };

  /* 迷你折线（首页趋势卡） */
  C['spark-line'] = {
    props: { points: Array, color: { type: String, default: '#1890FF' }, height: { type: Number, default: 40 }, width: { type: Number, default: 150 } },
    computed: {
      d: function () {
        var p = this.points || []; if (p.length < 2) return '';
        var max = Math.max.apply(null, p.map(function (x) { return x.value || 0; })) || 1;
        var min = Math.min.apply(null, p.map(function (x) { return x.value || 0; }));
        var span = (max - min) || 1;
        return p.map(function (x, i) {
          var px = (i * (this.width - 6) + 3) / (p.length - 1);
          var py = this.height - 4 - ((x.value - min) / span) * (this.height - 8);
          return (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
        }, this).join(' ');
      }
    },
    template: `
      <svg :width="width" :height="height" :viewBox="'0 0 ' + width + ' ' + height">
        <path :d="d" fill="none" :stroke="color" stroke-width="1.8"></path>
      </svg>`
  };

  /* 分组卡片标题 */
  C['sec-title'] = {
    props: { title: String, hint: String, level: { type: Number, default: 4 } },
    template: `
      <div class="divider-label"><b style="color:var(--text);font-size:13.5px">{{ title }}</b><span class="muted small" v-if="hint">{{ hint }}</span></div>`
  };


  /* 统计周期选择器（月/季/年 + 期次切换 + 刷新时间），供统计分析 7 页复用 */
  C['period-bar'] = {
    props: { g: String, offset: Number, label: String, updatedAt: String, showRefresh: { type: Boolean, default: true } },
    emits: ['update:g', 'update:offset', 'refresh'],
    computed: {
      opts: function () {
        var g = this.g === 'quarter' ? 'quarter' : (this.g === 'year' ? 'year' : 'month');
        var out = [];
        for (var i = 0; i < 13; i++) {
          var p = global.Stats.period(g, i);
          out.push({ v: i, label: p.label });
        }
        return out;
      }
    },
    template: `
      <div class="card"><div class="card-body" style="padding:10px 16px">
        <div class="row">
          <span class="small muted">统计粒度</span>
          <select style="width:104px" :value="g" @change="$emit('update:g', $event.target.value); $emit('update:offset', 0)">
            <option value="month">月度</option><option value="quarter">季度</option><option value="year">年度</option>
          </select>
          <span class="small muted">统计周期</span>
          <select style="width:158px" :value="offset" @change="$emit('update:offset', +$event.target.value)">
            <option v-for="o in opts" :value="o.v">{{ o.label }}</option>
          </select>
          <span class="tag blue">{{ label }}</span>
          <button class="btn sm" :disabled="offset>=12" @click="$emit('update:offset', offset+1)">‹ 上一期</button>
          <button class="btn sm" :disabled="offset<=0" @click="$emit('update:offset', Math.max(0, offset-1))">下一期 ›</button>
          <span class="spacer" style="flex:1"></span>
          <span class="small muted" v-if="updatedAt">数据最后更新：{{ updatedAt }}</span>
          <button class="btn sm" v-if="showRefresh" @click="$emit('refresh')">↻ 手动刷新统计</button>
        </div>
      </div></div>`
  };

  /* 权限受限提示（IX-1.4：无操作权限 → disabled + tooltip） */
  C['lock-btn'] = {
    props: { label: String, ok: Boolean, reason: String, cls: { type: String, default: '' } },
    emits: ['click'],
    template: `
      <span class="tooltip-host">
        <button class="btn" :class="cls" :disabled="!ok" @click="$emit('click')">{{ label }}</button>
        <span class="tooltip" v-if="!ok && reason">{{ reason }}</span>
      </span>`
  };
})(typeof window !== 'undefined' ? window : globalThis);
