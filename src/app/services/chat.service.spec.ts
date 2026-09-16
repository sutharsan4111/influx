import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ChatService]
    });

    service = TestBed.inject(ChatService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('sendMessage', () => {
    it('should POST message to chat endpoint', () => {
      const mockResponse = 'AI response';
      const testMessage = 'Hello, world!';

      service.sendMessage(testMessage).subscribe(response => {
        expect(response).toBe(mockResponse);
      });

      const req = httpMock.expectOne('/chat');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ message: testMessage });
      req.flush(mockResponse);
    });

    it('should handle empty message', () => {
      const mockResponse = 'Empty message received';
      const testMessage = '';

      service.sendMessage(testMessage).subscribe(response => {
        expect(response).toBe(mockResponse);
      });

      const req = httpMock.expectOne('/chat');
      expect(req.request.body).toEqual({ message: '' });
      req.flush(mockResponse);
    });
  });
});