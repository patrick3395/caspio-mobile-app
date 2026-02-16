import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { liveQuery } from 'dexie';
import { db, StoredNotification } from './caspio-db';

@Injectable({
  providedIn: 'root'
})
export class NotificationStoreService {

  addNotification(title: string, body: string, type?: string, data?: any): Promise<string> {
    const id = this.generateId();
    return db.notifications.add({
      id,
      title,
      body,
      type: type || undefined,
      data: data || undefined,
      read: 0,
      receivedAt: Date.now()
    });
  }

  getAll$(): Observable<StoredNotification[]> {
    return this.toRxObservable(
      liveQuery(() => db.notifications.orderBy('receivedAt').reverse().toArray())
    );
  }

  getUnreadCount$(): Observable<number> {
    return this.toRxObservable(
      liveQuery(() => db.notifications.where('read').equals(0).count())
    );
  }

  async markAsRead(id: string): Promise<void> {
    await db.notifications.update(id, { read: 1 });
  }

  async clearAll(): Promise<void> {
    await db.notifications.clear();
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  private toRxObservable<T>(dexieObservable: any): Observable<T> {
    return new Observable<T>(subscriber => {
      const subscription = dexieObservable.subscribe(
        (value: T) => subscriber.next(value),
        (error: any) => subscriber.error(error),
        () => subscriber.complete()
      );
      return () => subscription.unsubscribe();
    });
  }
}
