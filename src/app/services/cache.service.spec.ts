import { TestBed } from '@angular/core/testing';
import { CacheService, CacheEntry } from './cache.service';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CacheService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('get', () => {
    it('should return undefined for non-existent key', () => {
      expect(service.get('non-existent')).toBeUndefined();
    });

    it('should return cached data when valid', () => {
      const testData = { id: 1, name: 'Test' };
      service.set('test-key', testData, 60000);
      expect(service.get('test-key')).toEqual(testData);
    });

    it('should return undefined and delete expired entry', () => {
      const testData = { id: 1, name: 'Test' };
      service.set('test-key', testData, -1);
      expect(service.get('test-key')).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should store data with default TTL', () => {
      const testData = { id: 1, name: 'Test' };
      service.set('test-key', testData);
      expect(service.get('test-key')).toEqual(testData);
    });

    it('should store data with custom TTL', () => {
      const testData = { id: 1, name: 'Test' };
      service.set('test-key', testData, 10000);
      expect(service.get('test-key')).toEqual(testData);
    });

    it('should overwrite existing key', () => {
      service.set('key', { value: 1 });
      service.set('key', { value: 2 });
      expect(service.get('key')).toEqual({ value: 2 });
    });
  });

  describe('invalidate', () => {
    it('should remove specific key', () => {
      service.set('key', { value: 1 });
      service.invalidate('key');
      expect(service.get('key')).toBeUndefined();
    });

    it('should not throw for non-existent key', () => {
      expect(() => service.invalidate('non-existent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      service.set('key1', { value: 1 });
      service.set('key2', { value: 2 });
      service.clear();
      expect(service.get('key1')).toBeUndefined();
      expect(service.get('key2')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for valid cached key', () => {
      service.set('key', { value: 1 });
      expect(service.has('key')).toBeTrue();
    });

    it('should return false for non-existent key', () => {
      expect(service.has('non-existent')).toBeFalse();
    });

    it('should return false and delete expired key', () => {
      service.set('key', { value: 1 }, -1);
      expect(service.has('key')).toBeFalse();
    });
  });
});