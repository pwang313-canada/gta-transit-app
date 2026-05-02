import moment from 'moment';

export const formatTime = (time: string): string => {
  return moment(time, 'HH:mm').format('h:mm A');
};

export const getCurrentHour = (): number => {
  return new Date().getHours();
};

export const isTimeAfterNow = (time: string): boolean => {
  const [hour, minute] = time.split(':').map(Number);
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  if (hour > currentHour) return true;
  if (hour === currentHour && minute >= currentMinute) return true;
  return false;
};
