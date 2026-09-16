import { TestBed } from '@angular/core/testing';
import { MessageService } from './message.service';

describe('MessageService', () => {
  let service: MessageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MessageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initially have no message', (done) => {
    service.message$.subscribe(msg => {
      expect(msg).toBeNull();
      done();
    });
  });

  it('should emit message when show is called', (done) => {
    service.message$.subscribe(msg => {
      if (msg) {
        expect(msg).toEqual({ text: 'Test message', type: 'success' });
        done();
      }
    });
    service.show('Test message', 'success');
  });

  it('should emit error message', (done) => {
    service.message$.subscribe(msg => {
      if (msg) {
        expect(msg).toEqual({ text: 'Error message', type: 'error' });
        done();
      }
    });
    service.show('Error message', 'error');
  });

  it('should emit info message', (done) => {
    service.message$.subscribe(msg => {
      if (msg) {
        expect(msg).toEqual({ text: 'Info message', type: 'info' });
        done();
      }
    });
    service.show('Info message', 'info');
  });

  it('should have success convenience method', (done) => {
    service.message$.subscribe(msg => {
      if (msg) {
        expect(msg).toEqual({ text: 'Success!', type: 'success' });
        done();
      }
    });
    service.success('Success!');
  });

  it('should have error convenience method', (done) => {
    service.message$.subscribe(msg => {
      if (msg) {
        expect(msg).toEqual({ text: 'Error!', type: 'error' });
        done();
      }
    });
    service.error('Error!');
  });

  it('should have info convenience method', (done) => {
    service.message$.subscribe(msg => {
      if (msg) {
        expect(msg).toEqual({ text: 'Info!', type: 'info' });
        done();
      }
    });
    service.info('Info!');
  });

  it('should auto-clear message after 4 seconds', (done) => {
    let messageCount = 0;
    service.message$.subscribe(msg => {
      messageCount++;
      if (messageCount === 2) {
        expect(msg).toBeNull();
        done();
      }
    });
    service.show('Test message', 'success');
  });
});