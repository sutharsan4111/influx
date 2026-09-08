import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MessageService } from '../../services/message.service';
import { CloudOpsAssetsService, AssetPage, AssetColumn, AssetRow } from '../../services/cloudops-assets.service';

const DATA_TYPES: { value: AssetColumn['data_type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'select', label: 'Dropdown' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' }
];

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="assets-page">
      <!-- LEFT: Page list -->
      <div class="pages-panel">
        <div class="panel-title">
          <span><i class="fas fa-boxes-stacked"></i> Assets</span>
          <button class="icon-btn add-page-icon-btn" title="New page" (click)="openNewPageModal()">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="page-list">
          <div class="page-item"
               *ngFor="let p of pages"
               [class.active]="selectedPage?.id === p.id"
               (click)="selectPage(p)">
            <i class="fas" [ngClass]="p.is_system_page ? 'fa-table' : 'fa-file-lines'"></i>
            <span class="page-name">{{ p.display_name }}</span>
            <span class="page-count" *ngIf="p.row_count !== undefined">{{ p.row_count }}</span>
            <button class="icon-btn danger page-delete-btn" title="Delete page" (click)="deletePage(p, $event)">
              <i class="fas fa-trash"></i>
            </button>
          </div>
          <div class="empty-hint" *ngIf="!loadingPages && pages.length === 0">No pages yet</div>
        </div>
      </div>

      <!-- MAIN: Grid -->
      <div class="main-panel">
        <div class="loading" *ngIf="loadingPages">
          <i class="fas fa-spinner fa-spin"></i> Loading pages...
        </div>

        <ng-container *ngIf="!loadingPages && selectedPage">
          <div class="grid-header">
            <div class="header-left">
              <h2>{{ selectedPage.display_name }}</h2>
              <p class="text-muted" *ngIf="selectedPage.description">{{ selectedPage.description }}</p>
            </div>
            <div class="header-actions">
              <button class="btn-secondary" (click)="openColumnModal()">
                <i class="fas fa-table-columns"></i> Manage Columns
              </button>
              <button class="btn-primary" (click)="addRow()" [disabled]="columns.length === 0">
                <i class="fas fa-plus"></i> Add Row
              </button>
              <button class="btn-danger-outline" (click)="deletePage(selectedPage)">
                <i class="fas fa-trash"></i> Delete Page
              </button>
            </div>
          </div>

          <div class="loading" *ngIf="loadingGrid">
            <i class="fas fa-spinner fa-spin"></i> Loading data...
          </div>

          <div class="grid-wrapper" *ngIf="!loadingGrid">
            <div class="empty-state" *ngIf="columns.length === 0">
              <i class="fas fa-table-columns empty-icon"></i>
              <p>No columns defined yet. Add columns to start entering data.</p>
              <button class="btn-primary btn-small" (click)="openColumnModal()"><i class="fas fa-plus"></i> Add Column</button>
            </div>

            <table class="asset-table" *ngIf="columns.length > 0">
              <colgroup>
                <col class="col-sno">
                <col *ngFor="let col of columns" [style.width.px]="getColWidth(col)">
                <col class="col-actions">
              </colgroup>
              <thead>
                <tr>
                  <th class="row-num-col">S.No</th>
                  <th *ngFor="let col of columns" class="resizable-th">
                    <span class="th-label">{{ col.display_name }}<span class="req-star" *ngIf="col.is_required">*</span></span>
                    <span class="col-resizer" (mousedown)="startResize($event, col)"></span>
                  </th>
                  <th class="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of rows; let i = index" [class.editing]="editingRowId === row.id">
                  <td class="row-num-col">{{ i + 1 }}</td>
                  <td *ngFor="let col of columns">
                    <ng-container [ngSwitch]="col.data_type">
                      <input *ngSwitchCase="'boolean'" type="checkbox"
                             [checked]="!!row.row_data[col.name]"
                             (change)="onCellChange(row, col, $any($event.target).checked)">
                      <select *ngSwitchCase="'select'"
                              [ngModel]="row.row_data[col.name]"
                              (ngModelChange)="onCellChange(row, col, $event)">
                        <option [ngValue]="null">--</option>
                        <option *ngFor="let opt of col.select_options" [ngValue]="opt">{{ opt }}</option>
                      </select>
                      <input *ngSwitchCase="'date'" type="date"
                             [ngModel]="row.row_data[col.name]"
                             (ngModelChange)="onCellChange(row, col, $event)">
                      <input *ngSwitchCase="'number'" type="number"
                             [ngModel]="row.row_data[col.name]"
                             (ngModelChange)="onCellChange(row, col, $event)">
                      <input *ngSwitchDefault [type]="col.data_type === 'email' ? 'email' : (col.data_type === 'url' ? 'url' : 'text')"
                             [ngModel]="row.row_data[col.name]"
                             (ngModelChange)="onCellChange(row, col, $event)">
                    </ng-container>
                  </td>
                  <td class="actions-col">
                    <button class="icon-btn danger" (click)="deleteRow(row)" title="Delete row">
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
                <tr *ngIf="rows.length === 0">
                  <td [attr.colspan]="columns.length + 2" class="empty-row">No rows yet. Click "Add Row" to get started.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ng-container>

        <div class="empty-state" *ngIf="!loadingPages && !selectedPage">
          <i class="fas fa-boxes-stacked empty-icon"></i>
          <p>Select a page from the left, or create a new one.</p>
        </div>
      </div>
    </div>

    <!-- New Page Modal -->
    <div class="modal-overlay" *ngIf="showNewPageModal" (click)="closeNewPageModal()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h3>New Asset Page</h3>
          <button class="icon-btn" (click)="closeNewPageModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <label>Page Name</label>
          <input type="text" [(ngModel)]="newPage.display_name" placeholder="e.g. Spare Parts">
          <label>Description (optional)</label>
          <textarea [(ngModel)]="newPage.description" rows="2" placeholder="What is this page used for?"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" (click)="closeNewPageModal()">Cancel</button>
          <button class="btn-primary" [disabled]="!newPage.display_name.trim() || savingPage" (click)="createPage()">
            <i class="fas fa-spinner fa-spin" *ngIf="savingPage"></i> Create Page
          </button>
        </div>
      </div>
    </div>

    <!-- Manage Columns Modal -->
    <div class="modal-overlay" *ngIf="showColumnModal" (click)="closeColumnModal()">
      <div class="modal wide" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h3>Manage Columns — {{ selectedPage?.display_name }}</h3>
          <button class="icon-btn" (click)="closeColumnModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="column-list">
            <div class="column-row" *ngFor="let col of columns">
              <span class="col-name">{{ col.display_name }}</span>
              <span class="col-type">{{ col.data_type }}</span>
              <span class="col-req" *ngIf="col.is_required">Required</span>
              <button class="icon-btn danger" (click)="removeColumn(col)" title="Remove column">
                <i class="fas fa-trash"></i>
              </button>
            </div>
            <div class="empty-hint" *ngIf="columns.length === 0">No columns yet</div>
          </div>

          <div class="divider"></div>

          <h4>Add Column</h4>
          <label>Column Name</label>
          <input type="text" [(ngModel)]="newColumn.display_name" placeholder="e.g. Warranty Expiry">
          <label>Type</label>
          <select [(ngModel)]="newColumn.data_type">
            <option *ngFor="let t of dataTypes" [value]="t.value">{{ t.label }}</option>
          </select>
          <label *ngIf="newColumn.data_type === 'select'">Dropdown Options (comma separated)</label>
          <input *ngIf="newColumn.data_type === 'select'" type="text" [(ngModel)]="newColumnOptionsText" placeholder="Option A, Option B, Option C">
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="newColumn.is_required"> Required field
          </label>
          <button class="btn-primary" [disabled]="!newColumn.display_name?.trim() || savingColumn" (click)="addColumn()">
            <i class="fas fa-spinner fa-spin" *ngIf="savingColumn"></i>
            <i class="fas fa-plus" *ngIf="!savingColumn"></i> Add Column
          </button>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" (click)="closeColumnModal()">Done</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .assets-page {
      display: flex;
      height: calc(100vh - 60px);
      background: #f5f6fa;
    }

    .pages-panel {
      width: 156px;
      background: #fff;
      border-right: 1px solid #e5e7eb;
      display: flex;
      flex-direction: column;
      padding: 16px 10px;
    }

    .panel-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #1f2937;
    }
    .panel-title i { margin-right: 6px; color: #6366f1; }
    .add-page-icon-btn {
      color: #4f46e5;
      background: #eef2ff;
    }
    .add-page-icon-btn:hover { background: #e0e7ff; }

    .page-list { flex: 1; overflow-y: auto; }

    .page-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 4px;
      color: #374151;
      transition: background 0.15s;
    }
    .page-item:hover { background: #f3f4f6; }
    .page-item:hover .page-delete-btn { display: inline-flex; }
    .page-item.active { background: #eef2ff; color: #4f46e5; font-weight: 600; }
    .page-item i { width: 16px; color: #9ca3af; }
    .page-item.active i { color: #6366f1; }
    .page-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .page-count {
      font-size: 11px;
      background: #e5e7eb;
      color: #6b7280;
      padding: 1px 7px;
      border-radius: 10px;
    }
    .page-item.active .page-count { background: #c7d2fe; color: #4338ca; }
    .page-delete-btn {
      display: none;
      width: auto;
      padding: 4px 6px;
      font-size: 12px;
    }

    .main-panel { flex: 1; padding: 20px 24px; overflow-y: auto; }

    .grid-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .grid-header h2 { margin: 0; font-size: 20px; color: #111827; }
    .text-muted { color: #6b7280; font-size: 13px; margin: 4px 0 0; }
    .header-actions { display: flex; gap: 8px; }

    .btn-primary, .btn-secondary, .btn-danger-outline {
      border: none;
      border-radius: 8px;
      padding: 9px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-primary { background: #4f46e5; color: #fff; }
    .btn-primary:hover { background: #4338ca; }
    .btn-primary:disabled { background: #c7d2fe; cursor: not-allowed; }
    .btn-small { padding: 6px 12px; font-size: 12px; }
    .btn-small i { font-size: 11px; }
    .btn-secondary { background: #f3f4f6; color: #374151; }
    .btn-secondary:hover { background: #e5e7eb; }
    .btn-danger-outline { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
    .btn-danger-outline:hover { background: #fef2f2; }

    .loading { padding: 40px; text-align: center; color: #6b7280; }

    .grid-wrapper { background: #fff; border-radius: 10px; border: 1px solid #e5e7eb; overflow: auto; }

    .asset-table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
    .asset-table th {
      position: relative;
      background: #f9fafb;
      text-align: left;
      padding: 10px 16px 10px 12px;
      font-weight: 600;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .asset-table th.resizable-th { user-select: none; }
    .th-label { overflow: hidden; text-overflow: ellipsis; }
    .col-resizer {
      position: absolute;
      top: 0;
      right: 0;
      width: 6px;
      height: 100%;
      cursor: col-resize;
      z-index: 2;
    }
    .col-resizer:hover, .col-resizer:active { background: #6366f1; }
    .asset-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: middle;
      overflow: hidden;
    }
    .asset-table tr:hover td { background: #fafafa; }
    .req-star { color: #dc2626; margin-left: 2px; }

    .asset-table input[type=text],
    .asset-table input[type=number],
    .asset-table input[type=date],
    .asset-table input[type=email],
    .asset-table input[type=url],
    .asset-table select {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid transparent;
      background: transparent;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 13px;
    }
    .asset-table input:hover, .asset-table select:hover { border-color: #e5e7eb; }
    .asset-table input:focus, .asset-table select:focus {
      outline: none;
      border-color: #6366f1;
      background: #fff;
      box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
    }

    .col-sno { width: 56px; }
    .col-actions { width: 60px; }
    .row-num-col { width: 56px; color: #9ca3af; text-align: center; }
    .actions-col { width: 60px; text-align: center; }
    .empty-row { text-align: center; padding: 24px; color: #9ca3af; }

    .icon-btn {
      border: none;
      background: transparent;
      cursor: pointer;
      color: #9ca3af;
      padding: 6px;
      border-radius: 6px;
    }
    .icon-btn:hover { background: #f3f4f6; color: #374151; }
    .icon-btn.danger:hover { background: #fef2f2; color: #dc2626; }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #9ca3af;
    }
    .empty-state .empty-icon { font-size: 32px; margin-bottom: 12px; display: block; color: #d1d5db; }

    .empty-hint { color: #9ca3af; font-size: 13px; padding: 8px 4px; }

    /* Modal */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal {
      background: #fff; border-radius: 12px; width: 420px; max-width: 90vw;
      max-height: 85vh; display: flex; flex-direction: column;
    }
    .modal.wide { width: 520px; }
    .modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid #e5e7eb;
    }
    .modal-header h3 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 20px; overflow-y: auto; }
    .modal-body label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin: 12px 0 6px; }
    .modal-body label:first-child { margin-top: 0; }
    .modal-body input[type=text], .modal-body select, .modal-body textarea {
      width: 100%; padding: 9px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; box-sizing: border-box;
    }
    .checkbox-label { display: flex !important; align-items: center; gap: 8px; font-weight: 500 !important; }
    .checkbox-label input { width: auto !important; }
    .modal-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 14px 20px; border-top: 1px solid #e5e7eb;
    }

    .column-list { max-height: 200px; overflow-y: auto; }
    .column-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 4px; border-bottom: 1px solid #f3f4f6;
    }
    .col-name { flex: 1; font-size: 13px; font-weight: 500; color: #111827; }
    .col-type { font-size: 11px; background: #f3f4f6; color: #6b7280; padding: 2px 8px; border-radius: 10px; }
    .col-req { font-size: 11px; color: #dc2626; }
    .divider { height: 1px; background: #e5e7eb; margin: 16px 0; }
    h4 { margin: 0 0 4px; font-size: 13px; color: #374151; }
  `]
})
export class AssetsComponent implements OnInit {
  pages: AssetPage[] = [];
  selectedPage: AssetPage | null = null;
  columns: AssetColumn[] = [];
  rows: AssetRow[] = [];

  loadingPages = false;
  loadingGrid = false;
  editingRowId: number | null = null;

  dataTypes = DATA_TYPES;

  showNewPageModal = false;
  newPage: { display_name: string; description: string } = { display_name: '', description: '' };
  savingPage = false;

  showColumnModal = false;
  newColumn: Partial<AssetColumn> = { display_name: '', data_type: 'text', is_required: false };
  newColumnOptionsText = '';
  savingColumn = false;

  private saveTimers: { [rowId: number]: any } = {};
  columnWidths: { [colId: number]: number } = {};
  private static readonly DEFAULT_COL_WIDTH = 160;
  private static readonly MIN_COL_WIDTH = 80;

  constructor(private assetsService: CloudOpsAssetsService, private messageService: MessageService) {}

  ngOnInit(): void {
    this.loadPages();
  }

  async loadPages(): Promise<void> {
    this.loadingPages = true;
    try {
      this.pages = await firstValueFrom(this.assetsService.getPages());
      if (this.pages.length > 0 && !this.selectedPage) {
        this.selectPage(this.pages[0]);
      }
    } catch (err) {
      console.error('Failed to load asset pages', err);
      this.messageService.error('Failed to load asset pages');
    } finally {
      this.loadingPages = false;
    }
  }

  async selectPage(page: AssetPage): Promise<void> {
    this.selectedPage = page;
    this.loadingGrid = true;
    this.columns = [];
    this.rows = [];
    this.columnWidths = {};
    try {
      const full = await firstValueFrom(this.assetsService.getPage(page.id!));
      this.columns = (full.columns || []).slice().sort((a, b) => (a.column_order || 0) - (b.column_order || 0));
      this.rows = (full.rows || []).map(r => ({ ...r, row_data: r.row_data || {} }));
    } catch (err) {
      console.error('Failed to load page', err);
      this.messageService.error('Failed to load page data');
    } finally {
      this.loadingGrid = false;
    }
  }

  openNewPageModal(): void {
    this.newPage = { display_name: '', description: '' };
    this.showNewPageModal = true;
  }
  closeNewPageModal(): void {
    this.showNewPageModal = false;
  }

  async createPage(): Promise<void> {
    if (!this.newPage.display_name.trim()) return;
    this.savingPage = true;
    try {
      const created = await firstValueFrom(this.assetsService.createPage({
        name: this.newPage.display_name,
        display_name: this.newPage.display_name.trim(),
        description: this.newPage.description.trim()
      }));
      this.pages.push(created);
      this.showNewPageModal = false;
      this.selectPage(created);
      this.messageService.success('Page created');
    } catch (err: any) {
      console.error('Failed to create page', err);
      this.messageService.error(err?.error?.message || 'Failed to create page');
    } finally {
      this.savingPage = false;
    }
  }

  async deletePage(page: AssetPage | null, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!page) return;
    if (!confirm(`Delete page "${page.display_name}"? This will remove all its data.`)) return;
    try {
      await firstValueFrom(this.assetsService.deletePage(page.id!));
      this.pages = this.pages.filter(p => p.id !== page.id);
      if (this.selectedPage?.id === page.id) {
        this.selectedPage = null;
        this.columns = [];
        this.rows = [];
        if (this.pages.length > 0) this.selectPage(this.pages[0]);
      }
      this.messageService.success('Page deleted');
    } catch (err: any) {
      console.error('Failed to delete page', err);
      this.messageService.error(err?.error?.message || 'Failed to delete page');
    }
  }

  openColumnModal(): void {
    this.newColumn = { display_name: '', data_type: 'text', is_required: false };
    this.newColumnOptionsText = '';
    this.showColumnModal = true;
  }
  closeColumnModal(): void {
    this.showColumnModal = false;
  }

  async addColumn(): Promise<void> {
    if (!this.selectedPage || !this.newColumn.display_name?.trim()) return;
    this.savingColumn = true;
    try {
      const payload: Partial<AssetColumn> = {
        name: this.newColumn.display_name.trim(),
        display_name: this.newColumn.display_name.trim(),
        data_type: this.newColumn.data_type,
        is_required: !!this.newColumn.is_required
      };
      if (this.newColumn.data_type === 'select') {
        payload.select_options = this.newColumnOptionsText
          .split(',')
          .map(o => o.trim())
          .filter(o => o.length > 0);
      }
      const col = await firstValueFrom(this.assetsService.addColumn(this.selectedPage.id!, payload));
      this.columns.push(col);
      this.newColumn = { display_name: '', data_type: 'text', is_required: false };
      this.newColumnOptionsText = '';
      this.messageService.success('Column added');
    } catch (err: any) {
      console.error('Failed to add column', err);
      this.messageService.error(err?.error?.message || 'Failed to add column');
    } finally {
      this.savingColumn = false;
    }
  }

  async removeColumn(col: AssetColumn): Promise<void> {
    if (!this.selectedPage) return;
    if (!confirm(`Remove column "${col.display_name}"? Data in this column will be lost.`)) return;
    try {
      await firstValueFrom(this.assetsService.deleteColumn(this.selectedPage.id!, col.id!));
      this.columns = this.columns.filter(c => c.id !== col.id);
      this.messageService.success('Column removed');
    } catch (err: any) {
      console.error('Failed to remove column', err);
      this.messageService.error(err?.error?.message || 'Failed to remove column');
    }
  }

  async addRow(): Promise<void> {
    if (!this.selectedPage || this.columns.length === 0) return;
    const row_data: { [key: string]: any } = {};
    for (const col of this.columns) {
      row_data[col.name] = col.data_type === 'boolean' ? false : (col.default_value ?? null);
    }
    try {
      const row = await firstValueFrom(this.assetsService.createRow(this.selectedPage.id!, row_data));
      this.rows.push({ ...row, row_data: row.row_data || {} });
    } catch (err: any) {
      console.error('Failed to add row', err);
      this.messageService.error(err?.error?.message || 'Failed to add row');
    }
  }

  onCellChange(row: AssetRow, col: AssetColumn, value: any): void {
    row.row_data[col.name] = value;
    this.scheduleSaveRow(row);
  }

  private scheduleSaveRow(row: AssetRow): void {
    if (!row.id) return;
    if (this.saveTimers[row.id]) clearTimeout(this.saveTimers[row.id]);
    this.editingRowId = row.id;
    this.saveTimers[row.id] = setTimeout(async () => {
      try {
        await firstValueFrom(this.assetsService.updateRow(this.selectedPage!.id!, row.id!, row.row_data));
      } catch (err) {
        console.error('Failed to save row', err);
        this.messageService.error('Failed to save changes');
      } finally {
        this.editingRowId = null;
      }
    }, 600);
  }

  getColWidth(col: AssetColumn): number {
    return (col.id && this.columnWidths[col.id]) || AssetsComponent.DEFAULT_COL_WIDTH;
  }

  startResize(event: MouseEvent, col: AssetColumn): void {
    event.preventDefault();
    event.stopPropagation();
    if (!col.id) return;
    const colId = col.id;
    const startX = event.clientX;
    const startWidth = this.getColWidth(col);

    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(AssetsComponent.MIN_COL_WIDTH, startWidth + (e.clientX - startX));
      this.columnWidths = { ...this.columnWidths, [colId]: newWidth };
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  async deleteRow(row: AssetRow): Promise<void> {
    if (!this.selectedPage || !row.id) return;
    if (!confirm('Delete this row?')) return;
    try {
      await firstValueFrom(this.assetsService.deleteRow(this.selectedPage.id!, row.id));
      this.rows = this.rows.filter(r => r.id !== row.id);
    } catch (err: any) {
      console.error('Failed to delete row', err);
      this.messageService.error(err?.error?.message || 'Failed to delete row');
    }
  }
}
