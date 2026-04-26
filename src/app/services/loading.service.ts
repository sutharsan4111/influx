import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private loading = new BehaviorSubject<boolean>(false);
  public loading$ = this.loading.asObservable();
  private pending = 0;

  show() {
    this.pending += 1;
    this.loading.next(true);
  }

  hide() {
    this.pending = Math.max(0, this.pending - 1);
    this.loading.next(this.pending > 0);
  }

  isLoading(): boolean {
    return this.loading.value;
  }

  clear(): void {
    this.pending = 0;
    this.loading.next(false);
  }
}
