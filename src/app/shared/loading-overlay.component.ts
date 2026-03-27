import { Component } from '@angular/core';
import { LoadingService } from '../services/loading.service';

@Component({
  selector: 'app-loading-overlay',
  standalone: true,
  template: `
    <div class="loading-overlay" [class.show]="loadingService.isLoading()">
      <div class="spinner"></div>
    </div>
  `
})
export class LoadingOverlayComponent {
  constructor(public loadingService: LoadingService) {}
}
