import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Message {
  text: string;
  type: 'success' | 'error' | 'info';
}

@Injectable({
  providedIn: 'root'
})
export class MessageService {
  private message = new BehaviorSubject<Message | null>(null);
  public message$ = this.message.asObservable();

  show(text: string, type: 'success' | 'error' | 'info' = 'success') {
    this.message.next({ text, type });
    setTimeout(() => {
      this.message.next(null);
    }, 4000);
  }

  success(text: string) {
    this.show(text, 'success');
  }

  error(text: string) {
    this.show(text, 'error');
  }

  info(text: string) {
    this.show(text, 'info');
  }
}
