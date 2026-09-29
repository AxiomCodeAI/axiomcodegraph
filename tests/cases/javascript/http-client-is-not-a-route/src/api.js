import { api } from './client';

export function readProfile(res) { return res; }

export const updateProfile = ({ data }) => readProfile(api.patch(`/users/profile`, data));
