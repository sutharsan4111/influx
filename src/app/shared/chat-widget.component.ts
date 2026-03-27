import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../services/chat.service';

interface ChatMessage {
  sender: 'user' | 'bot';
  text: string;
}

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat-container" *ngIf="visible">
      <div class="chat-header">
        <span>ITSM Assistant</span>
        <button (click)="close()">✖</button>
      </div>

      <div class="chat-body">
        <div *ngFor="let msg of messages"
             [class.user]="msg.sender === 'user'"
             [class.bot]="msg.sender === 'bot'">
          {{ msg.text }}
        </div>
      </div>

      <div class="chat-footer">
        <input
          [(ngModel)]="userInput"
          (keydown.enter)="send()"
          placeholder="Type your message..."
        />
        <button (click)="send()">Send</button>
      </div>
    </div>
  `,
  styles: [`
  .chat-container {
    position: fixed;
    right: 90px;
    bottom: 20px;
    width: 340px;
    height: 460px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    display: flex;
    flex-direction: column;
    z-index: 3000;
    overflow: hidden;
    font-family: Arial, sans-serif;
    animation: slideIn 0.3s ease-out;
  }

  .chat-header {
    background: linear-gradient(135deg, #1976d2, #1565c0);
    color: white;
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
  }

  .chat-header button {
    background: transparent;
    border: none;
    color: white;
    font-size: 18px;
    cursor: pointer;
  }

  .chat-body {
    flex: 1;
    padding: 12px;
    overflow-y: auto;
    background: #f5f7fb;
  }

  .chat-body .user,
  .chat-body .bot {
    max-width: 75%;
    padding: 8px 12px;
    margin-bottom: 10px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.4;
    word-wrap: break-word;
  }

  .chat-body .user {
    background: #1976d2;
    color: white;
    margin-left: auto;
    border-bottom-right-radius: 4px;
  }

  .chat-body .bot {
    background: #e0e0e0;
    color: #333;
    margin-right: auto;
    border-bottom-left-radius: 4px;
  }

  .chat-footer {
    display: flex;
    padding: 10px;
    border-top: 1px solid #ddd;
    background: #ffffff;
  }

  .chat-footer input {
    flex: 1;
    padding: 8px 10px;
    border-radius: 20px;
    border: 1px solid #ccc;
    outline: none;
    font-size: 14px;
  }

  .chat-footer button {
    margin-left: 8px;
    padding: 0 14px;
    border-radius: 20px;
    border: none;
    background: #1976d2;
    color: white;
    cursor: pointer;
  }

  .chat-footer button:hover {
    background: #125ea2;
  }
  @keyframes slideIn {
  from {
    transform: translateX(30px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

`]
})
export class ChatWidgetComponent {

  visible = false;
  userInput = '';
  messages: ChatMessage[] = [];

  constructor(private chatService: ChatService) {}

  open() {
    this.visible = true;
  }

  close() {
    this.visible = false;
  }

 send() {
  if (!this.userInput.trim()) return;

  const userText = this.userInput;

  // show user message
  this.messages.push({ sender: 'user', text: userText });
  this.userInput = '';

  // call AI backend
  this.chatService.sendMessage(userText).subscribe({
    next: (reply) => {
      this.messages.push({
        sender: 'bot',
        text: reply
      });
    },
    error: () => {
      this.messages.push({
        sender: 'bot',
        text: 'Sorry, I am unable to respond right now.'
      });
    }
  });
}

}
