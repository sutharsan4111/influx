import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface Feature {
  icon: string;
  title: string;
  description: string;
  category: string;
  roles: string[];
  isNew?: boolean;
}

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="features-page">
      <div class="page-header">
        <div class="header-left">
          <div class="brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div>
            <h1>Features</h1>
            <p class="header-subtitle">Everything Influx has to offer — and what's new</p>
          </div>
        </div>
      </div>

      <div class="whats-new-banner" *ngIf="newFeatures.length > 0">
        <div class="new-badge">NEW</div>
        <span>{{ newFeatures.length }} feature{{ newFeatures.length === 1 ? '' : 's' }} recently added</span>
      </div>

      <div class="category-section" *ngFor="let cat of categories">
        <h2 class="category-title">{{ cat }}</h2>
        <div class="features-grid">
          <div class="feature-card" *ngFor="let f of getFeaturesByCategory(cat)" [class.is-new]="f.isNew">
            <div class="feature-icon" [innerHTML]="trustHtml(f.icon)"></div>
            <div class="feature-body">
              <div class="feature-title-row">
                <h3>{{ f.title }}</h3>
                <span class="new-tag" *ngIf="f.isNew">New</span>
              </div>
              <p>{{ f.description }}</p>
              <div class="role-tags">
                <span class="role-tag" *ngFor="let r of f.roles" [class.role-all]="r === 'All Users'">{{ r }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .features-page {
      padding: 0 0 24px;
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 20px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .header-left { display: flex; align-items: center; gap: 16px; }

    .brand-icon {
      width: 44px; height: 44px; border-radius: 12px;
      background: linear-gradient(135deg, #7c3aed, #a855f7);
      color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }

    h1 { margin: 0; font-size: 1.35rem; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; }
    .header-subtitle { margin: 2px 0 0; font-size: 0.85rem; color: #64748b; }

    .whats-new-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
      padding: 14px 20px;
      background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      color: #166534;
      font-weight: 600;
      font-size: 0.88rem;
    }

    .new-badge {
      background: linear-gradient(135deg, #16a34a, #15803d);
      color: white;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .category-section {
      margin-top: 28px;
    }

    .category-title {
      margin: 0 0 16px;
      font-size: 1rem;
      font-weight: 700;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }

    .feature-card {
      display: flex;
      gap: 16px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      transition: all 0.2s ease;
    }

    .feature-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.06);
      border-color: #cbd5e1;
    }

    .feature-card.is-new {
      border-color: #86efac;
      background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%);
    }

    .feature-icon {
      width: 42px;
      height: 42px;
      min-width: 42px;
      border-radius: 10px;
      background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #475569;
    }

    .feature-icon :is(svg) {
      width: 20px;
      height: 20px;
    }

    .feature-body { min-width: 0; }

    .feature-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .feature-title-row h3 {
      margin: 0;
      font-size: 0.92rem;
      font-weight: 700;
      color: #0f172a;
    }

    .new-tag {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: white;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .feature-body p {
      margin: 0 0 10px;
      font-size: 0.82rem;
      color: #64748b;
      line-height: 1.5;
    }

    .role-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .role-tag {
      background: #eef2ff;
      color: #4338ca;
      border: 1px solid #e0e7ff;
      padding: 2px 9px;
      border-radius: 20px;
      font-size: 0.68rem;
      font-weight: 600;
    }

    .role-tag.role-all {
      background: #f1f5f9;
      color: #475569;
      border-color: #e2e8f0;
    }

    /* Dark Theme */
    :host-context(.dark-theme) .page-header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border-color: #334155;
    }

    :host-context(.dark-theme) h1 { color: #e2e8f0; }
    :host-context(.dark-theme) .header-subtitle { color: #94a3b8; }

    :host-context(.dark-theme) .whats-new-banner {
      background: linear-gradient(135deg, #052e16 0%, #14532d 100%);
      border-color: #166534;
      color: #86efac;
    }

    :host-context(.dark-theme) .category-title { color: #e2e8f0; }

    :host-context(.dark-theme) .feature-card {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border-color: #334155;
    }

    :host-context(.dark-theme) .feature-card:hover {
      border-color: #475569;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }

    :host-context(.dark-theme) .feature-card.is-new {
      border-color: #166534;
      background: linear-gradient(135deg, #0f172a 0%, #052e16 100%);
    }

    :host-context(.dark-theme) .feature-icon {
      background: linear-gradient(135deg, #1e293b, #334155);
      color: #94a3b8;
    }

    :host-context(.dark-theme) .feature-title-row h3 { color: #e2e8f0; }
    :host-context(.dark-theme) .feature-body p { color: #94a3b8; }

    :host-context(.dark-theme) .role-tag {
      background: rgba(99, 102, 241, 0.16);
      color: #c7d2fe;
      border-color: rgba(99, 102, 241, 0.3);
    }

    :host-context(.dark-theme) .role-tag.role-all {
      background: #1e293b;
      color: #94a3b8;
      border-color: #334155;
    }

    @media (max-width: 860px) {
      .features-page { padding: 0 0 16px; }
      .page-header { flex-direction: column; align-items: stretch; padding: 18px 20px; }
      .features-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class FeaturesComponent {
  constructor(private sanitizer: DomSanitizer) {}

  trustHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  features: Feature[] = [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      title: 'Dashboard',
      description: 'Real-time overview of ticket volume, SLA status, and team performance at a glance.',
      category: 'Core',
      roles: ['Admin', 'CloudOps']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
      title: 'Ticket Management',
      description: 'Create, assign, track, and resolve support tickets with full lifecycle control.',
      category: 'Core',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      title: 'SLA Tracking',
      description: 'Monitor response and resolution times against defined service level agreements.',
      category: 'Core',
      roles: ['Admin', 'CloudOps']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      title: 'Role-Based Access',
      description: 'Admin, CloudOps, and User roles with dynamic role switching and access control.',
      category: 'Core',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      title: 'Secure Authentication',
      description: 'Azure AD / Microsoft MSAL single sign-on with JWT token fallback for secure access.',
      category: 'Core',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
      title: 'Notifications',
      description: 'Real-time ticket update notifications and email alerts for assignment changes.',
      category: 'Core',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      title: 'Feedback & Reporting',
      description: 'Submit issues, suggestions, and feedback directly from the application header.',
      category: 'Core',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      title: 'SSL & Automation SSL Monitoring',
      description: 'Track SSL certificate expiries and automated health checks across environments, with alert tickets raised before they lapse.',
      category: 'Infrastructure',
      roles: ['Admin', 'CloudOps']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
      title: 'IHUB License & Certificate Tracking',
      description: 'Two dedicated pages for IHUB License and IHUB Certificate expiries, each with automated renewal alert tickets before they lapse.',
      category: 'Infrastructure',
      roles: ['Admin', 'CloudOps'],
      isNew: true
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      title: 'Azure Backup Reports',
      description: 'Recovery Services vaults with live VM and Azure Files backup consistency, recovery type, and last backup status.',
      category: 'Infrastructure',
      roles: ['CloudOps'],
      isNew: true
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
      title: 'CloudOps Projects',
      description: 'Plan, track, and manage CloudOps initiatives and project boards in one dedicated workspace.',
      category: 'Infrastructure',
      roles: ['Admin', 'CloudOps'],
      isNew: true
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
      title: 'Admin Panel',
      description: 'Centralized configuration for users, roles, automation rules, and system settings.',
      category: 'Administration',
      roles: ['Admin']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      title: 'User Role Management',
      description: 'Assign and manage user roles, permissions, and access levels across the platform.',
      category: 'Administration',
      roles: ['Admin']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      title: 'Recycle Bin',
      description: 'Recover deleted tickets and data with a safety net for accidental deletions.',
      category: 'Administration',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
      title: 'Dark Mode',
      description: 'Toggle between light and dark themes for comfortable viewing in any environment.',
      category: 'Experience',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
      title: 'Responsive Design',
      description: 'Fully responsive interface that works seamlessly across desktop, tablet, and mobile.',
      category: 'Experience',
      roles: ['All Users']
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      title: 'Role Switching',
      description: 'Switch between admin and cloud operator roles instantly without re-logging.',
      category: 'Experience',
      roles: ['Admin', 'CloudOps'],
      isNew: true
    }
  ];

  get categories(): string[] {
    return [...new Set(this.features.map(f => f.category))];
  }

  get newFeatures(): Feature[] {
    return this.features.filter(f => f.isNew);
  }

  getFeaturesByCategory(category: string): Feature[] {
    return this.features.filter(f => f.category === category);
  }
}
