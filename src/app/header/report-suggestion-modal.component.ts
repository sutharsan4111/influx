import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-report-suggestion-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './report-suggestion-modal.component.html',
  styleUrls: ['./report-suggestion-modal.component.css']
})
export class ReportSuggestionModalComponent {
  reportContent = '';
  includeName = false;

  @Output() submitted = new EventEmitter<{ content: string; includeName: boolean }>();
  @Output() closed = new EventEmitter<void>();

  submitReport() {
    if (this.reportContent.trim()) {
      this.submitted.emit({ content: this.reportContent, includeName: this.includeName });
      this.reportContent = '';
      this.includeName = false;
    }
  }

  closeReportModal() {
    this.closed.emit();
  }
}
