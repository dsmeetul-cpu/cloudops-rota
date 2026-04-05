// src/utils/defaults.js

export const UK_BANK_HOLIDAYS = [
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-04-21', name: 'Easter Monday' },
  { date: '2025-05-05', name: 'Early May Bank Holiday' },
  { date: '2025-05-26', name: 'Spring Bank Holiday' },
  { date: '2025-08-25', name: 'Summer Bank Holiday' },
  { date: '2025-12-25', name: 'Christmas Day' },
  { date: '2025-12-26', name: 'Boxing Day' },
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-04', name: 'Early May Bank Holiday' },
  { date: '2026-05-25', name: 'Spring Bank Holiday' },
  { date: '2026-08-31', name: 'Summer Bank Holiday' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-28', name: 'Boxing Day' },
];

export const SHIFTS = {
  daily:   { label: 'Daily',            time: '9am–6pm',  days: 'Mon–Fri',  color: 'shift-daily',   tag: 'tag-blue'   },
  evening: { label: 'Weekday Evening',  time: '7pm–7am',  days: 'Mon–Thu',  color: 'shift-evening', tag: 'tag-purple' },
  weekend: { label: 'Weekend',          time: '7pm–7am',  days: 'Fri–Mon',  color: 'shift-weekend', tag: 'tag-pink'   },
  off:     { label: 'Off',              time: '',         days: '',         color: 'shift-off',     tag: ''           },
};

export const DEFAULT_USERS = [
  { id: 'MBA47', name: 'Meetul Bhundia', role: 'Manager',  tri: 'MBA', avatar: 'MB', color: '#1d4ed8' },
  { id: 'MAH01', name: 'Mahir',          role: 'Engineer', tri: 'MAH', avatar: 'MH', color: '#7c3aed' },
  { id: 'DAR02', name: 'Darshana',       role: 'Engineer', tri: 'DAR', avatar: 'DS', color: '#0d9488' },
  { id: 'MAR03', name: 'Marc',           role: 'Engineer', tri: 'MAR', avatar: 'MC', color: '#be185d' },
];

export const DEFAULT_HOLIDAYS = [
  { id: 'h1', userId: 'MAH01', start: '2026-04-14', end: '2026-04-17', status: 'approved', note: 'Family trip' },
  { id: 'h2', userId: 'DAR02', start: '2026-04-21', end: '2026-04-24', status: 'pending',  note: 'Holiday'     },
  { id: 'h3', userId: 'MAR03', start: '2026-05-04', end: '2026-05-08', status: 'approved', note: 'Staycation'  },
];

export const DEFAULT_INCIDENTS = [
  { id: 'INC-001', title: 'API Gateway latency spike',      severity: 'P1', status: 'Resolved',     reporter: 'MAH01', date: '2026-04-03 14:22', desc: 'API latency >5s for 12 mins. Rolled back deploy v2.1.4.' },
  { id: 'INC-002', title: 'Cloud Run OOM on prod cluster',  severity: 'P2', status: 'Investigating', reporter: 'DAR02', date: '2026-04-04 09:15', desc: 'Memory limit hit on prod. Scaling group adjusted.'       },
  { id: 'INC-003', title: 'Monitoring alert false positive', severity: 'P3', status: 'Closed',       reporter: 'MAR03', date: '2026-04-02 16:45', desc: 'Alert threshold misconfigured post-upgrade.'             },
];

export const DEFAULT_TIMESHEETS = {
  MBA47: [{ week: 'W14', hours: 40, oncall: 2,  notes: 'Normal week'      }, { week: 'W13', hours: 38, oncall: 0, notes: 'Half-day Fri'     }],
  MAH01: [{ week: 'W14', hours: 40, oncall: 8,  notes: 'Weekend cover'    }, { week: 'W13', hours: 42, oncall: 8, notes: 'Incident response' }],
  DAR02: [{ week: 'W14', hours: 38, oncall: 4,  notes: ''                 }, { week: 'W13', hours: 40, oncall: 0, notes: ''                  }],
  MAR03: [{ week: 'W14', hours: 40, oncall: 4,  notes: ''                 }, { week: 'W13', hours: 40, oncall: 8, notes: 'Weekend cover'      }],
};

export const DEFAULT_UPGRADES = [
  { id: 'u1', date: '2026-04-22', name: 'Global Q2 System Upgrade', attendees: ['MBA47', 'MAH01', 'DAR02'] },
  { id: 'u2', date: '2026-07-15', name: 'Global Q3 System Upgrade', attendees: ['MBA47'] },
];

export const DEFAULT_WIKI = [
  { id: 'w1', title: 'Incident Response Runbook', cat: 'Operations', content: '1. Assess severity\n2. Page on-call engineer\n3. Create incident bridge\n4. Communicate to stakeholders\n5. Root cause analysis within 24h' },
  { id: 'w2', title: 'Cloud Run Deployment Guide', cat: 'Engineering', content: 'Use gcloud run deploy with --region europe-west2. Always set --max-instances cap. Ensure health checks pass before traffic switch.' },
  { id: 'w3', title: 'On-Call Expectations', cat: 'Process', content: 'Respond within 15 mins for P1/P2. Log all actions in incident tracker. Hand off at shift end with summary.' },
];

export const DEFAULT_GLOSSARY = [
  { id: 'g1', term: 'SLA',  def: 'Service Level Agreement — commitment on uptime/response' },
  { id: 'g2', term: 'MTTR', def: 'Mean Time to Recovery' },
  { id: 'g3', term: 'RCA',  def: 'Root Cause Analysis' },
  { id: 'g4', term: 'OOM',  def: 'Out Of Memory — process exceeds memory limit' },
];

export const DEFAULT_CONTACTS = [
  { id: 'c1', name: 'Google Support', role: 'Cloud Support', email: 'cloud-support@google.com', phone: '+1 855 836 3987' },
  { id: 'c2', name: 'Security Team',  role: 'Internal',      email: 'security@company.com',     phone: 'x4499'           },
  { id: 'c3', name: 'Platform Team',  role: 'Internal',      email: 'platform@company.com',     phone: 'x3100'           },
];

export const DEFAULT_PAYCONFIG = {
  MBA47: { rate: 75,  base: 4500 },
  MAH01: { rate: 45,  base: 3000 },
  DAR02: { rate: 42,  base: 2800 },
  MAR03: { rate: 40,  base: 2700 },
};

export const TRICOLORS = ['#1d4ed8','#7c3aed','#0d9488','#be185d','#b45309','#6d28d9','#065f46','#9d174d'];

export function generateTrigramId(name, existingUsers) {
  const tri = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X');
  const num  = String(existingUsers.length + 1).padStart(2, '0');
  return tri + num;
}

export function generateRota(users, startDate, weeks = 4) {
  const engineers = users.filter(u => u.role === 'Engineer');
  if (engineers.length === 0) return {};
  const rows = {};
  const base = new Date(startDate);
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(base);
      date.setDate(base.getDate() + w * 7 + d);
      const dow = date.getDay(); // 0=Sun
      const ds  = date.toISOString().slice(0, 10);
      users.forEach(u => { if (!rows[u.id]) rows[u.id] = {}; });
      if (dow >= 1 && dow <= 5) {
        // Weekday daily
        const dailyEng   = engineers[(w * 2 + 0) % engineers.length];
        const eveningEng  = dow <= 4 ? engineers[(w * 2 + 1) % engineers.length] : null;
        users.forEach(u => {
          rows[u.id][ds] =
            u.id === dailyEng.id   ? 'daily'
            : u.id === eveningEng?.id ? 'evening'
            : 'off';
        });
      } else {
        // Weekend
        const wkndEng = engineers[w % engineers.length];
        users.forEach(u => { rows[u.id][ds] = u.id === wkndEng.id ? 'weekend' : 'off'; });
      }
    }
  }
  return rows;
}
