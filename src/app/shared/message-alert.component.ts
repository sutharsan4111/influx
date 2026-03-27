import { Component } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { MessageService } from '../services/message.service';

@Component({
  selector: 'app-message-alert',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
  template: `
    <ng-container *ngIf="messageService.message$ | async as message">
      <div class="message-alert show"
           [class.success]="message.type === 'success'"
           [class.error]="message.type === 'error'"
           [class.info]="message.type === 'info'">
        {{ message.text }}
      </div>
    </ng-container>
  `,
  styles: []
})
export class MessageAlertComponent {
  constructor(public messageService: MessageService) {}
}
