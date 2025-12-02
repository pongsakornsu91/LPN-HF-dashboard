

import { Injectable, signal, computed } from '@angular/core';

// Declaration for GAS
declare var google: any;

export interface Patient {
  id: string;
  hn: string;
  firstName: string;
  lastName: string;
  age: number;
  gender: 'ชาย' | 'หญิง';
  insurance: string;
  address: {
    number: string;
    subDistrict: string;
    district: string;
    province: string;
  };
  status: 'OPD' | 'IPD';
  lvef: number;
  lastAdmission?: string;
  dischargeDate?: string;
  
  // IPD Specific
  an?: string; // Admission Number
  admissionCount?: number; // Count of admissions in fiscal year
  fiscalYear?: string; // Track which FY this count belongs to
  isReadmission?: boolean; // Flag for 30-day readmission
  etiology?: string;
  admitWard?: string;
  isRespiFailure?: boolean;
  isDiureticAdjust?: boolean;
  admissionNote?: string;

  meds: {
    acei_arb: boolean;
    arni: boolean; // Mutually exclusive with ACEI/ARB
    betaBlocker: boolean;
    mra: boolean;
    sglt2i: boolean;
  };
  targetDoseReached?: {
    acei_arb_arni: boolean;
    betaBlocker: boolean;
    mra: boolean;
  };
  nextAppointment?: {
    date: string;
    location: string;
    detail?: string; 
  };
  notes?: string;
}

@Injectable({
  providedIn: 'root'
})
export class HfDataService {
  // Signals for State
  readonly patients = signal<Patient[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isGasEnvironment = signal<boolean>(false);
  
  readonly filter = signal<{ 
    lvefGroup?: string; 
    province?: string; 
    district?: string; 
    subDistrict?: string;
    etiology?: string;
    insurance?: string;
    ageGroup?: string;
    dateRangeStart?: string;
    dateRangeEnd?: string;
    appointmentDate?: string;
    appointmentLocation?: string; // New Filter
    medication?: 'acei_arb' | 'arni' | 'acei_arb_arni' | 'betaBlocker' | 'mra' | 'sglt2i';
    status?: 'OPD' | 'IPD';
    isActiveIpd?: boolean;
    month?: string; 
    isReadmit30d?: boolean;
    isLvefLess50?: boolean; 
    isTripleTherapy?: boolean;
    isRespiFailure?: boolean;
    isDiureticAdjust?: boolean;
    hasNextAppointment?: boolean;
  }>({});

  constructor() {
    this.checkEnvironment();
    this.loadData();
    
    setInterval(() => {
      // Only silent refresh if environment is stable
      if (this.patients().length > 0) {
        this.loadData(true); 
      }
    }, 60000);
  }

  private checkEnvironment() {
    if (typeof google !== 'undefined' && google.script) {
      this.isGasEnvironment.set(true);
      console.log('Environment: Google Apps Script (Live)');
    } else {
      console.log('Environment: Local/Dev (Mock Data)');
    }
  }

  loadData(silent = false) {
    if (!silent) this.isLoading.set(true);

    if (this.isGasEnvironment()) {
      google.script.run
        .withSuccessHandler((response: string) => {
          try {
            const data = JSON.parse(response);
            if (Array.isArray(data)) {
              this.patients.set(data);
              if (!silent) console.log('Data loaded from Sheet:', data.length, 'records');
            } else {
              console.warn('Sheet returned invalid data structure.');
            }
          } catch (e) {
            console.error('Failed to parse server response', e);
          }
          this.isLoading.set(false);
        })
        .withFailureHandler((error: any) => {
          console.error('GAS Error:', error);
          this.isLoading.set(false);
        })
        .getPatients();
    } else {
      // Local Mock Logic
      if (this.patients().length === 0) {
        this.generateMockData();
      }
      setTimeout(() => this.isLoading.set(false), 500);
    }
  }

  savePatientToSheet(patient: Patient): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isGasEnvironment()) {
        const jsonStr = JSON.stringify(patient);
        google.script.run
          .withSuccessHandler((response: string) => {
            const res = JSON.parse(response);
            if (res.success) {
              this.updateLocalState(patient);
              resolve(true);
            } else {
              console.error('Save failed:', res.error);
              resolve(false);
            }
          })
          .withFailureHandler((error: any) => {
            console.error('GAS Save Error:', error);
            resolve(false);
          })
          .savePatient(jsonStr);
      } else {
        this.updateLocalState(patient);
        setTimeout(() => resolve(true), 800);
      }
    });
  }

  deletePatient(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isGasEnvironment()) {
        google.script.run
          .withSuccessHandler((response: string) => {
             const res = JSON.parse(response);
             if (res.success) {
               this.patients.update(curr => curr.filter(p => p.id !== id));
               resolve(true);
             } else {
               console.error('Delete failed:', res.error);
               resolve(false);
             }
          })
          .withFailureHandler((error: any) => {
             console.error('GAS Delete Error:', error);
             resolve(false);
          })
          .deletePatient(id);
      } else {
        this.patients.update(curr => curr.filter(p => p.id !== id));
        setTimeout(() => resolve(true), 500);
      }
    });
  }

  private updateLocalState(p: Patient) {
    const current = this.patients();
    const exists = current.find(x => x.id === p.id);
    if (exists) {
      this.patients.update(curr => curr.map(item => item.id === p.id ? p : item));
    } else {
      this.patients.update(curr => [p, ...curr]);
    }
  }
  
  downloadCsv() {
    const data = this.filteredPatients();
    if (!data.length) return;
    
    const headers = ['HN', 'AN', 'ชื่อ-สกุล', 'อายุ', 'เพศ', 'สิทธิการรักษา', 'สถานะ', 'Admit Count', 'Re-admit(30d)', 'Ward', 'RespiFail', 'LVEF', 'ที่อยู่', 'ยา', 'วันที่ Admit ล่าสุด', 'วันนัดถัดไป', 'สถานที่นัด'];
    const rows = data.map(p => {
       const meds = [];
       if(p.meds.acei_arb) meds.push('ACEI/ARB');
       if(p.meds.arni) meds.push('ARNi');
       if(p.meds.betaBlocker) meds.push('BB');
       if(p.meds.mra) meds.push('MRA');
       if(p.meds.sglt2i) meds.push('SGLT2i');
       
       const sanitize = (val: any) => `"${(val || '').toString().replace(/"/g, '""')}"`;
       const fullName = `${p.firstName} ${p.lastName}`;
       const address = `${p.address.number} ต.${p.address.subDistrict} อ.${p.address.district} จ.${p.address.province}`;

       return [
         sanitize(p.hn), 
         sanitize(p.an || ''), 
         sanitize(fullName), 
         sanitize(p.age), 
         sanitize(p.gender), 
         sanitize(p.insurance),
         sanitize(p.status),
         sanitize(p.admissionCount || 1),
         sanitize(p.isReadmission ? 'Yes' : 'No'),
         sanitize(p.admitWard || '-'),
         sanitize(p.isRespiFailure ? 'Yes' : 'No'),
         sanitize(p.lvef), 
         sanitize(address), 
         sanitize(meds.join('|')), 
         sanitize(p.lastAdmission), 
         sanitize(p.nextAppointment?.date),
         sanitize(p.nextAppointment?.location || '-')
       ].join(',');
    });
    
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    this.triggerDownload(csvContent, 'hf_registry_export.csv', 'text/csv;charset=utf-8;');
  }

  downloadBackup() {
     const data = JSON.stringify(this.patients(), null, 2);
     const date = new Date().toISOString().split('T')[0];
     this.triggerDownload(data, `hf_registry_backup_${date}.json`, 'application/json');
  }
  
  importDatabase(jsonString: string): Promise<boolean> {
      return new Promise((resolve) => {
          try {
             const patients = JSON.parse(jsonString);
             if(!Array.isArray(patients)) throw new Error("Invalid JSON format: Expected an array.");
             
             if(this.isGasEnvironment()) {
                 google.script.run
                   .withSuccessHandler((resStr: string) => {
                       const res = JSON.parse(resStr);
                       if(res.success) {
                           this.patients.set(patients); 
                           resolve(true);
                       } else {
                           console.error('GAS Import Error:', res.error);
                           resolve(false);
                       }
                   })
                   .withFailureHandler((err: any) => {
                       console.error('GAS connection error:', err);
                       resolve(false);
                   })
                   .saveAllPatients(jsonString); 
             } else {
                 this.patients.set(patients);
                 setTimeout(() => resolve(true), 1000);
             }
          } catch(e) {
              console.error('Import parsing error:', e);
              resolve(false);
          }
      });
  }

  private triggerDownload(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type: type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private generateMockData() {
    const provinces = ['ลำพูน', 'เชียงใหม่', 'ลำปาง'];
    const districts = ['เมือง', 'ป่าซาง', 'บ้านโฮ่ง', 'แม่ทา', 'ลี้', 'ทุ่งหัวช้าง', 'เวียงหนองล่อง'];
    const subDistricts = ['ในเมือง', 'อุโมงค์', 'มะเขือแจ้', 'เหมืองจี้', 'ต้นธง', 'บ้านแป้น', 'น้ำดิบ', 'นครเจดีย์'];
    const etiologies = [
        'Ischemic', 
        'Non-ischemic', 
        'Other (HTN heart disease, Pulmonary hypertension, Severe VHD)'
    ];
    const insuranceTypes = ['บัตรทอง (UC)', 'ประกันสังคม', 'ข้าราชการ (เบิกจ่ายตรง)', 'ชำระเงินเอง'];
    
    const clinics = [
      'OPD Cardio LPN (พุธ)',
      'OPD HF ป่าซาง',
      'OPD HF ลี้',
      'HF clinic (ส่งต่อ LPN)'
    ];
    
    const wards = ['ICU Med', 'Male Med', 'Female Med', 'Ward 10'];

    const data: Patient[] = Array.from({ length: 50 }).map((_, i) => {
      const isIpd = Math.random() > 0.7;
      const lvef = Math.floor(Math.random() * 60) + 15;
      
      const today = new Date();
      const daysAgo = Math.floor(Math.random() * 90); 
      const lastAdmit = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000); 
      const discharge = new Date(lastAdmit.getTime() + Math.random() * 10 * 24 * 60 * 60 * 1000); 
      const nextAppt = new Date(today.getTime() + (Math.floor(Math.random() * 60) - 30) * 24 * 60 * 60 * 1000); 

      const hasArni = Math.random() > 0.6; 
      const hasAceiArb = !hasArni && Math.random() > 0.3; 
      const prov = Math.random() > 0.8 ? provinces[Math.floor(Math.random() * (provinces.length - 1)) + 1] : provinces[0];
      
      const isReadmit = isIpd && Math.random() > 0.8;

      return {
        id: `P${i + 1000}`,
        hn: `HN${66000 + i}`,
        an: isIpd || Math.random() > 0.5 ? `AN${660000 + i}` : undefined,
        admissionCount: Math.floor(Math.random() * 3) + 1,
        fiscalYear: '2025',
        isReadmission: isReadmit,
        firstName: `ผู้ป่วย`,
        lastName: `ลำดับที่ ${i + 1}`,
        age: Math.floor(Math.random() * 50) + 40,
        gender: Math.random() > 0.5 ? 'ชาย' : 'หญิง',
        insurance: insuranceTypes[Math.floor(Math.random() * insuranceTypes.length)],
        address: {
          number: `${Math.floor(Math.random() * 99)}/1`,
          subDistrict: subDistricts[Math.floor(Math.random() * subDistricts.length)],
          district: districts[Math.floor(Math.random() * districts.length)],
          province: prov
        },
        status: isIpd ? 'IPD' : 'OPD',
        lvef: lvef,
        lastAdmission: lastAdmit.toISOString().split('T')[0],
        dischargeDate: isIpd ? undefined : discharge.toISOString().split('T')[0], 
        etiology: etiologies[Math.floor(Math.random() * etiologies.length)],
        admitWard: isIpd ? wards[Math.floor(Math.random() * wards.length)] : undefined,
        isRespiFailure: isIpd ? Math.random() > 0.8 : undefined,
        isDiureticAdjust: isIpd ? Math.random() > 0.5 : undefined,
        
        meds: {
          acei_arb: hasAceiArb,
          arni: hasArni,
          betaBlocker: Math.random() > 0.2,
          mra: Math.random() > 0.4,
          sglt2i: Math.random() > 0.4
        },
        targetDoseReached: {
          acei_arb_arni: Math.random() > 0.5,
          betaBlocker: Math.random() > 0.5,
          mra: Math.random() > 0.5
        },
        nextAppointment: {
          date: nextAppt.toISOString().split('T')[0],
          location: clinics[Math.floor(Math.random() * clinics.length)],
          detail: 'เจาะเลือด, Echo'
        },
        notes: '-'
      };
    });
    this.patients.set(data);
  }

  // --- Computed Analytics ---

  readonly filteredPatients = computed(() => {
    const all = this.patients();
    const f = this.filter();
    
    return all.filter(p => {
      let match = true;
      
      if (f.status) match = match && p.status === f.status;
      if (f.isActiveIpd) match = match && p.status === 'IPD' && !p.dischargeDate;

      if (p.lastAdmission) {
          const admitDate = p.lastAdmission;
          if (f.dateRangeStart && admitDate < f.dateRangeStart) match = false;
          if (f.dateRangeEnd && admitDate > f.dateRangeEnd) match = false;
      } else if (f.dateRangeStart || f.dateRangeEnd) {
          match = false;
      }
      
      if (f.isReadmit30d) {
         // Explicitly check flag
         match = match && !!p.isReadmission;
      }

      if (f.lvefGroup) {
        if (f.lvefGroup === '<20%') match = match && p.lvef < 20;
        else if (f.lvefGroup === '20-30%') match = match && p.lvef >= 20 && p.lvef < 30;
        else if (f.lvefGroup === '30-40%') match = match && p.lvef >= 30 && p.lvef < 40;
        else if (f.lvefGroup === '40-50%') match = match && p.lvef >= 40 && p.lvef < 50;
        else if (f.lvefGroup === '>50%') match = match && p.lvef >= 50;
      }
      
      if (f.isLvefLess50) match = match && p.lvef < 50;
      
      if (f.province) match = match && p.address.province === f.province;
      if (f.district) match = match && p.address.district === f.district;
      if (f.subDistrict) match = match && p.address.subDistrict === f.subDistrict;
      
      if (f.etiology) match = match && p.etiology === f.etiology;
      if (f.insurance) match = match && p.insurance === f.insurance;
      
      if (f.ageGroup) {
          if(f.ageGroup === '<40') match = match && p.age < 40;
          else if(f.ageGroup === '41-60') match = match && p.age >= 41 && p.age <= 60;
          else if(f.ageGroup === '61-80') match = match && p.age >= 61 && p.age <= 80;
          else if(f.ageGroup === '>80') match = match && p.age > 80;
      }

      if (f.appointmentDate) match = match && p.nextAppointment?.date === f.appointmentDate;
      
      if (f.appointmentLocation) {
        match = match && p.nextAppointment?.location === f.appointmentLocation;
      }
      
      if (f.medication) {
        if (f.medication === 'acei_arb') match = match && p.meds.acei_arb;
        else if (f.medication === 'arni') match = match && p.meds.arni;
        else if (f.medication === 'acei_arb_arni') match = match && (p.meds.acei_arb || p.meds.arni);
        else if (f.medication === 'betaBlocker') match = match && p.meds.betaBlocker;
        else if (f.medication === 'mra') match = match && p.meds.mra;
        else if (f.medication === 'sglt2i') match = match && p.meds.sglt2i;
      }
      
      if (f.isTripleTherapy) {
         match = match && (p.meds.acei_arb || p.meds.arni) && p.meds.betaBlocker && p.meds.mra;
      }
      
      if (f.isRespiFailure) {
        match = match && !!p.isRespiFailure;
      }
      
      if (f.isDiureticAdjust) {
        match = match && !!p.isDiureticAdjust;
      }
      
      if (f.hasNextAppointment) {
        match = match && !!p.nextAppointment?.date;
      }

      return match;
    });
  });

  // Helpers to calc percentages
  private calculateMedStats(list: Patient[]) {
    const total = list.length || 1;
    const has3Meds = list.filter(p => (p.meds.acei_arb || p.meds.arni) && p.meds.betaBlocker && p.meds.mra).length;
    
    return {
      aceiArb: list.filter(p => p.meds.acei_arb).length / total * 100,
      arni: list.filter(p => p.meds.arni).length / total * 100,
      aceiArbArni: list.filter(p => p.meds.acei_arb || p.meds.arni).length / total * 100,
      betaBlocker: list.filter(p => p.meds.betaBlocker).length / total * 100,
      mra: list.filter(p => p.meds.mra).length / total * 100,
      sglt2i: list.filter(p => p.meds.sglt2i).length / total * 100,
      tripleTherapyCount: has3Meds
    };
  }

  readonly ipdStats = computed(() => {
    const list = this.filteredPatients(); 
    return this.calculateMedStats(list);
  });

  readonly opdStats = computed(() => {
    const all = this.patients();
    const opdList = all.filter(p => p.status === 'OPD');
    return this.calculateMedStats(opdList);
  });
  
  readonly medicationStats = computed(() => this.calculateMedStats(this.filteredPatients()));

  readonly stats = computed(() => {
    const all = this.patients();
    const ipdActive = all.filter(p => p.status === 'IPD' && !p.dischargeDate);
    const lvefLow = all.filter(p => p.lvef < 50);
    
    // Count patients with isReadmission flag
    const readmit = all.filter(p => p.isReadmission);

    const filtered = this.filteredPatients();
    const respi = filtered.filter(p => p.isRespiFailure).length;
    const diuretic = filtered.filter(p => p.isDiureticAdjust).length;
    const appt = filtered.filter(p => !!p.nextAppointment?.date).length;

    return {
      total: all.length,
      ipdActive: ipdActive.length,
      readmission30d: readmit.length,
      lvefLess50: lvefLow.length,
      respiFailureCount: respi,
      diureticAdjustCount: diuretic,
      appointmentCount: appt
    };
  });

  setFilter(key: string, value: any) {
    this.filter.update(f => ({ ...f, [key]: value }));
  }

  clearFilter() {
    this.filter.set({});
  }
}
