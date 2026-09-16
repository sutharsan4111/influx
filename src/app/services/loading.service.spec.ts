import { TestBed } from '@angular/core/testing';
import { LoadingService } from './loading.service';

describe('LoadingService', () => {
  let service: LoadingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LoadingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initially have loading as false', () => {
    expect(service.isLoading()).toBeFalse();
  });

  it('should set loading to true when show() is called', () => {
    service.show();
    expect(service.isLoading()).toBeTrue();
  });

  it('should set loading to false when hide() is called after show()', () => {
    service.show();
    service.hide();
    expect(service.isLoading()).toBeFalse();
  });

  it('should handle multiple show/hide calls correctly', () => {
    service.show();
    service.show();
    service.hide();
    expect(service.isLoading()).toBeTrue();
    service.hide();
    expect(service.isLoading()).toBeFalse();
  });

  it('should not go below zero pending count', () => {
    service.hide();
    expect(service.isLoading()).toBeFalse();
  });

  it('should emit loading state changes through observable', (done) => {
    const states: boolean[] = [];
    service.loading$.subscribe(state => states.push(state));

    service.show();
    service.hide();

    setTimeout(() => {
      expect(states).toEqual([false, true, false]);
      done();
    });
  });

  it('should reset completely with clear()', () => {
    service.show();
    service.show();
    service.clear();
    expect(service.isLoading()).toBeFalse();
  });
});