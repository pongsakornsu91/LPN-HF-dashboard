import { Component, ElementRef, inject, signal, computed, effect, ViewChild, AfterViewInit } from '@angular/core';
import { HfDataService, Patient } from './services/hf-data.service';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Global declaration for SweetAlert2
declare var Swal: any;
// Global declaration for D3
declare var d3: any;

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, DecimalPipe, DatePipe],
  templateUrl: './app.component.html'
})
export class AppComponent implements AfterViewInit {
  dataService = inject(HfDataService);
  
  // Auth State
  isLoggedIn = signal(false);
  userRole = signal<'admin' | 'opd' | null>(null);

  // UI State
  activeTab = signal(1);
  showModal = signal(false);
  isSaving = signal(false);
  selectedDate = signal<string | null>(null);
  
  // Date Ranges for Filter
  startDateFilter = signal<string>('');
  endDateFilter = signal<string>('');
  
  // Pagination State
  currentPage = signal(1);
  itemsPerPage = 50;

  // Drill-down Chart State
  locationLevel = signal<'province' | 'district' | 'subDistrict'>('province');
  locationBreadcrumb = signal<string[]>(['ทั้งหมด']);
  
  // View Modes
  medViewMode = signal<'combined' | 'specific'>('combined');
  trackingStatusFilter = signal<'IPD' | 'OPD'>('IPD');
  
  // Form State (Simple object to bind to)
  formState = signal<any>({});
  
  // Calendar Logic
  viewDate = signal(new Date()); // Current view for calendar
  calendarDays = signal<{ dayNum: number, date: Date, dateStr: string, hasAppt: boolean }[]>([]);

  @ViewChild('fileInput') fileInput!: ElementRef;

  constructor() {
    
    // Effect to redraw charts when tab changes or data changes
    effect(() => {
      const tab = this.activeTab();
      const data = this.dataService.patients(); // dependency
      const currentFilter = this.dataService.filter(); // dependency for reactivity
      
      // Re-generate calendar if data or filter changes (to update dots)
      this.generateCalendar();

      // Reset Pagination on filter change
      if (currentFilter) {
        this.currentPage.set(1);
      }

      // Logic for Tab 2: Default to last 30 days if no filter set
      if (tab === 2) {
         // Ensure status filter is set to current selection
         if (currentFilter.status !== this.trackingStatusFilter()) {
             setTimeout(() => this.dataService.setFilter('status', this.trackingStatusFilter()), 0);
         }

         if (!currentFilter.dateRangeStart && !currentFilter.dateRangeEnd) {
             const end = new Date();
             const start = new Date();
             start.setDate(end.getDate() - 30);
             
             const startStr = start.toISOString().split('T')[0];
             const endStr = end.toISOString().split('T')[0];
             
             this.startDateFilter.set(startStr);
             this.endDateFilter.set(endStr);
             
             this.dataService.setFilter('dateRangeStart', startStr);
             this.dataService.setFilter('dateRangeEnd', endStr);
         }
      } 
      
      // Logic for Tab 3: Filter status OPD
      if (tab === 3) {
          if (currentFilter.status !== 'OPD') {
              setTimeout(() => this.dataService.setFilter('status', 'OPD'), 0);
          }
      }

      // Small timeout to allow DOM to render
      setTimeout(() => {
        if (tab === 1) {
          this.renderLvefPieChart();
          this.renderLocationChart();
          this.renderAgeChart();
          this.renderInsuranceChart();
        } else if (tab === 2) {
          this.renderEtiologyChart();
        }
      }, 200);
    });
  }

  // --- Computed Lists for Datalist (Auto-complete) ---
  readonly uniqueProvinces = computed(() => {
    const provinces = this.dataService.patients().map(p => p.address.province).filter(Boolean);
    return [...new Set(provinces)].sort();
  });

  readonly uniqueDistricts = computed(() => {
    const districts = this.dataService.patients().map(p => p.address.district).filter(Boolean);
    return [...new Set(districts)].sort();
  });

  readonly uniqueSubDistricts = computed(() => {
    const subDistricts = this.dataService.patients().map(p => p.address.subDistrict).filter(Boolean);
    return [...new Set(subDistricts)].sort();
  });
  
  readonly uniqueInsurances = computed(() => {
    const insurances = this.dataService.patients().map(p => p.insurance).filter(Boolean);
    // Ensure default options are always present if not in DB yet
    const defaults = ['บัตรทอง (UC)', 'ประกันสังคม', 'ข้าราชการ (เบิกจ่ายตรง)', 'ชำระเงินเอง'];
    return [...new Set([...defaults, ...insurances])].sort();
  });
  
  // --- Pagination Computed ---
  readonly paginatedPatients = computed(() => {
    const all = this.dataService.filteredPatients();
    const start = (this.currentPage() - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    return all.slice(start, end);
  });
  
  readonly totalPages = computed(() => {
    return Math.ceil(this.dataService.filteredPatients().length / this.itemsPerPage);
  });

  readonly paginationEnd = computed(() => {
    const total = this.dataService.filteredPatients().length;
    const end = this.currentPage() * this.itemsPerPage;
    return Math.min(end, total);
  });
  
  changePage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  ngAfterViewInit() {
    // Initial render check
  }

  login(u: string, p: string, role: 'admin' | 'opd') {
    if (role === 'admin' && u === 'ipd' && p === '0811689908') {
      this.userRole.set('admin');
      this.isLoggedIn.set(true);
      Swal.fire({ icon: 'success', title: 'ยินดีต้อนรับ Admin', timer: 1500, showConfirmButton: false });
    } else if (role === 'opd' && u === 'opd' && p === '0811689908') {
      this.userRole.set('opd');
      this.isLoggedIn.set(true);
      Swal.fire({ icon: 'success', title: 'ยินดีต้อนรับ OPD Staff', timer: 1500, showConfirmButton: false });
    } else {
       Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบผิดพลาด', text: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  }

  logout() {
    this.isLoggedIn.set(false);
    this.userRole.set(null);
  }
  
  // --- Filter Handlers ---
  
  filterTotal() {
    this.dataService.clearFilter();
    this.resetLocationFilter();
  }

  filterActiveIPD() {
    this.dataService.setFilter('isActiveIpd', true);
  }
  
  filterReadmit() {
    this.dataService.setFilter('isReadmit30d', true);
  }
  
  filterLvefLow() {
    this.dataService.setFilter('isLvefLess50', true);
  }
  
  filterOpdTripleTherapy() {
     this.dataService.setFilter('isTripleTherapy', true);
  }
  
  filterOpdMed(med: any) {
     this.dataService.setFilter('medication', med);
  }

  filterSubDistrict(subDistrict: string) {
    this.dataService.setFilter('subDistrict', subDistrict);
  }
  
  filterOpdLocation(location: any) {
    const val = location.target.value;
    this.dataService.setFilter('appointmentLocation', val === 'all' ? undefined : val);
  }
  
  resetLocationFilter() {
      this.locationLevel.set('province');
      this.locationBreadcrumb.set(['ทั้งหมด']);
      this.dataService.setFilter('province', undefined);
      this.dataService.setFilter('district', undefined);
      this.dataService.setFilter('subDistrict', undefined);
  }
  
  // New Handlers for Tracking Tab
  updateTrackingStatus(event: any) {
    const status = event.target.value;
    this.trackingStatusFilter.set(status);
    this.dataService.setFilter('status', status);
  }

  filterRespiFailure() {
    this.dataService.setFilter('isRespiFailure', true);
  }
  
  filterDiureticAdjust() {
    this.dataService.setFilter('isDiureticAdjust', true);
  }
  
  filterTripleTherapy() {
    this.dataService.setFilter('isTripleTherapy', true);
  }
  
  filterNextAppointment() {
    this.dataService.setFilter('hasNextAppointment', true);
  }

  // --- Import / Export Handlers ---

  exportCsv() {
    this.dataService.downloadCsv();
  }

  backupDb() {
    this.dataService.downloadBackup();
  }

  triggerImport() {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e: any) => {
        const content = e.target.result;
        
        const result = await Swal.fire({
          title: 'ยืนยันการนำเข้าข้อมูล?',
          text: "ข้อมูลปัจจุบันจะถูกเขียนทับ ต้องการดำเนินการต่อหรือไม่?",
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#d33',
          cancelButtonText: 'ยกเลิก',
          confirmButtonText: 'ยืนยัน'
        });

        if (result.isConfirmed) {
           Swal.fire({
             title: 'กำลังนำเข้าข้อมูล...',
             text: 'กรุณารอสักครู่',
             allowOutsideClick: false,
             didOpen: () => Swal.showLoading()
           });
           
           const success = await this.dataService.importDatabase(content);
           
           if (success) {
             Swal.fire('สำเร็จ', 'อัปเดตฐานข้อมูลเรียบร้อยแล้ว', 'success');
           } else {
             Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถนำเข้าข้อมูลได้', 'error');
           }
        }
        // Reset input
        this.fileInput.nativeElement.value = '';
      };
      reader.readAsText(file);
    }
  }

  toggleMedView() {
    this.medViewMode.update(m => m === 'combined' ? 'specific' : 'combined');
  }

  applyMedFilter(med: 'acei_arb' | 'arni' | 'acei_arb_arni' | 'betaBlocker' | 'mra' | 'sglt2i') {
    this.dataService.setFilter('medication', med);
  }

  // --- Modal Logic ---

  getEmptyPatient(): any {
    return {
      id: '', hn: '', an: '', firstName: '', lastName: '', age: null, gender: 'ชาย',
      insurance: '', // Reset to empty to allow selection/typing
      address: { number: '', subDistrict: '', district: 'เมือง', province: 'ลำพูน' },
      status: 'OPD', lvef: null,
      etiology: '',
      admitWard: '',
      isRespiFailure: false,
      isDiureticAdjust: false,
      admissionNote: '',
      meds: { acei_arb: false, arni: false, betaBlocker: false, mra: false, sglt2i: false },
      targetDoseReached: { acei_arb_arni: false, betaBlocker: false, mra: false },
      nextAppointment: { date: '', location: 'OPD Cardio LPN (พุธ)', detail: '' },
      admissionCount: 0,
      fiscalYear: '',
      isReadmission: false
    };
  }
  
  checkExistingHn() {
    const currentHn = this.formState().hn;
    if (!currentHn || this.formState().id) return; 

    const existingPatient = this.dataService.patients().find(p => p.hn === currentHn);
    if (existingPatient) {
      const clone = JSON.parse(JSON.stringify(existingPatient));
      
      // Reset some fields for new entry context if needed, or keep as is for edit
      // Ensure fields exist
      if (!clone.targetDoseReached) clone.targetDoseReached = { acei_arb_arni: false, betaBlocker: false, mra: false };
      if (!clone.nextAppointment) clone.nextAppointment = { date: '', location: '', detail: '' };
      
      this.formState.set(clone);
      
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'info',
        title: 'พบข้อมูลผู้ป่วยเก่า',
        text: 'ดึงข้อมูลเรียบร้อยแล้ว',
        timer: 2000,
        showConfirmButton: false
      });
    }
  }

  openPatientModal() {
    this.formState.set(this.getEmptyPatient());
    this.showModal.set(true);
  }

  openEdit(p: Patient) {
    const clone = JSON.parse(JSON.stringify(p));
    if(!clone.nextAppointment) clone.nextAppointment = { date: '', location: '', detail: ''};
    if(!clone.targetDoseReached) clone.targetDoseReached = { acei_arb_arni: false, betaBlocker: false, mra: false };
    this.formState.set(clone);
    this.showModal.set(true);
  }
  
  async confirmDelete(p: Patient) {
    const result = await Swal.fire({
      title: 'ยืนยันการลบข้อมูล?',
      text: `คุณต้องการลบข้อมูลของ ${p.firstName} ${p.lastName} ใช่หรือไม่? การกระทำนี้ไม่สามารถเรียกคืนได้`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626', 
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'ลบข้อมูล',
      cancelButtonText: 'ยกเลิก'
    });

    if (result.isConfirmed) {
      Swal.fire({
        title: 'กำลังลบ...',
        text: 'กรุณารอสักครู่',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
      
      const success = await this.dataService.deletePatient(p.id);
      
      if (success) {
        Swal.fire('ลบสำเร็จ', 'ข้อมูลผู้ป่วยถูกลบเรียบร้อยแล้ว', 'success');
      } else {
        Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถลบข้อมูลได้', 'error');
      }
    }
  }
  
  openOpdModal() {
    this.formState.set(this.getEmptyPatient());
    this.showModal.set(true);
  }

  closeModal() {
    if (!this.isSaving()) {
      this.showModal.set(false);
    }
  }
  
  // Helper to get Thai Fiscal Year (Oct 1st start)
  getFiscalYear(date: Date): string {
    const month = date.getMonth(); // 0-11
    const year = date.getFullYear();
    // If Month is Oct(9), Nov(10), Dec(11), Fiscal Year is Next Year
    return (month >= 9) ? (year + 1).toString() : year.toString();
  }

  async savePatient() {
    const formData = this.formState();
    
    // Basic Validation
    if (!formData.hn || !formData.firstName || !formData.lastName) {
      Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบถ้วน', text: 'กรุณากรอก HN และ ชื่อ-นามสกุล' });
      return;
    }
    
    // Validation for IPD
    if (formData.status === 'IPD' && !formData.etiology) {
      Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบถ้วน', text: 'กรุณาระบุสาเหตุ Heart Failure (Etiology)' });
      return;
    }
    
    if (formData.status === 'IPD' && !formData.an) {
       Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบถ้วน', text: 'กรุณาระบุ AN สำหรับผู้ป่วย IPD' });
       return;
    }

    this.isSaving.set(true);

    // --- Logic: IPD Admission Counter (Fiscal Year) & Readmission ---
    if (formData.status === 'IPD') {
        // Determine Admission Date
        const admissionDate = formData.lastAdmission ? new Date(formData.lastAdmission) : new Date();
        const currentFiscalYear = this.getFiscalYear(admissionDate);
        
        // Retrieve existing record
        const existingRecord = this.dataService.patients().find(p => p.id === formData.id);
        
        let newCount = 1;

        if (existingRecord) {
            // 1. Readmission Logic: Compare current Admission Date with Previous Discharge Date
            // Definition: Re-admit (30 day) = (Admit Date - Discharge Date) < 30 days
            const prevDischarge = existingRecord.dischargeDate ? new Date(existingRecord.dischargeDate) : (existingRecord.lastAdmission ? new Date(existingRecord.lastAdmission) : null);
            
            if (prevDischarge) {
                // Difference in time
                const diffTime = Math.abs(admissionDate.getTime() - prevDischarge.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                // Check if it's a new admission event (e.g., was OPD before or new AN)
                const isNewEvent = existingRecord.status === 'OPD' || existingRecord.an !== formData.an;
                
                if (isNewEvent) {
                     if (diffDays < 30) {
                         formData.isReadmission = true;
                     } else {
                         formData.isReadmission = false;
                     }
                } else {
                    // Retain previous flag if just editing same admission
                    formData.isReadmission = existingRecord.isReadmission;
                }
            }

            // 2. Fiscal Year Logic for Admission Count
            const prevFiscalYear = existingRecord.fiscalYear;
            const prevCount = existingRecord.admissionCount || 0;

            if (prevFiscalYear === currentFiscalYear) {
               if (existingRecord.an !== formData.an) {
                   newCount = prevCount + 1;
               } else {
                   newCount = prevCount; // Editing same admission
               }
            } else {
               // New FY, reset count
               newCount = 1;
            }
        } else {
            // New Patient
            newCount = 1;
            formData.isReadmission = false; // First time
        }

        formData.admissionCount = newCount;
        formData.fiscalYear = currentFiscalYear;
    }

    // --- Logic: If IPD and Appointment Date is set, discharge patient (Change status to OPD) ---
    if (formData.status === 'IPD' && formData.nextAppointment && formData.nextAppointment.date) {
       formData.status = 'OPD';
       if (!formData.dischargeDate) {
          formData.dischargeDate = new Date().toISOString().split('T')[0];
       }
    }

    if (!formData.id) {
      formData.id = 'P' + Math.floor(Math.random() * 1000000);
    }

    try {
      const success = await this.dataService.savePatientToSheet(formData);
      
      if (success) {
        Swal.fire({
          title: 'บันทึกสำเร็จ!',
          text: 'อัปเดตข้อมูลลงฐานข้อมูลเรียบร้อยแล้ว',
          icon: 'success',
          confirmButtonColor: '#4f46e5'
        });
        this.showModal.set(false);
      } else {
        Swal.fire({
          title: 'เกิดข้อผิดพลาด',
          text: 'ไม่สามารถบันทึกลง Google Sheet ได้',
          icon: 'error'
        });
      }
    } catch (err) {
      console.error(err);
      Swal.fire('Error', 'Unexpected error occurred', 'error');
    } finally {
      this.isSaving.set(false);
    }
  }

  // --- Calendar Logic ---

  generateCalendar() {
    const viewDate = this.viewDate();
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Check against all patients or filtered patients depending on requirements
    // Here we check against all to show dots, but respect the specific OPD location filter if set
    const allPatients = this.dataService.patients();
    const locationFilter = this.dataService.filter().appointmentLocation;

    const days = [];
    for (let i = 1; i <= daysInMonth; i++) {
      // Construct date using local time components to avoid UTC offset issues
      // Note: Months are 0-indexed in JS Date
      const d = new Date(year, month, i);
      
      // Manually format to YYYY-MM-DD using local time values
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayStr = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${dayStr}`;
      
      const hasAppt = allPatients.some(p => {
          const isDateMatch = p.nextAppointment?.date === dateStr;
          const isStatusMatch = p.status === 'OPD';
          const isLocationMatch = locationFilter ? p.nextAppointment?.location === locationFilter : true;
          return isDateMatch && isStatusMatch && isLocationMatch;
      });

      days.push({
        dayNum: i,
        date: d,
        dateStr: dateStr,
        hasAppt: hasAppt
      });
    }
    this.calendarDays.set(days);
  }
  
  prevMonth() {
    const current = this.viewDate();
    this.viewDate.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
    this.generateCalendar();
  }

  nextMonth() {
    const current = this.viewDate();
    this.viewDate.set(new Date(current.getFullYear(), current.getMonth() + 1, 1));
    this.generateCalendar();
  }

  selectCalendarDate(date: Date) {
    // Format strictly YYYY-MM-DD using local time to match database string
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const s = `${y}-${m}-${d}`;
    
    this.selectedDate.set(s);
    this.dataService.setFilter('appointmentDate', s);
  }

  updateStartDate(event: any) {
    const val = event.target.value;
    this.startDateFilter.set(val);
    this.dataService.setFilter('dateRangeStart', val);
  }

  updateEndDate(event: any) {
    const val = event.target.value;
    this.endDateFilter.set(val);
    this.dataService.setFilter('dateRangeEnd', val);
  }

  // --- D3 Charts Implementation ---

  renderLvefPieChart() {
    const container = d3.select('#lvef-pie-chart');
    if (container.empty()) return;
    container.selectAll('*').remove(); 

    const width = 200, height = 180, radius = Math.min(width, height) / 2;
    const svg = container.append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width/2},${height/2})`);

    const patients = this.dataService.patients();
    const groups = { '<20%': 0, '20-30%': 0, '30-40%': 0, '40-50%': 0, '>50%': 0 };
    
    patients.forEach(p => {
      if(p.lvef < 20) groups['<20%']++;
      else if(p.lvef < 30) groups['20-30%']++;
      else if(p.lvef < 40) groups['30-40%']++;
      else if(p.lvef < 50) groups['40-50%']++;
      else groups['>50%']++;
    });

    const data = Object.entries(groups).map(([key, value]) => ({ key, value }));
    const color = d3.scaleOrdinal()
      .domain(Object.keys(groups))
      .range(['#dc2626', '#ea580c', '#d97706', '#2563eb', '#16a34a']);

    const pie = d3.pie().value((d: any) => d.value);
    const arc = d3.arc().innerRadius(40).outerRadius(radius - 5);

    svg.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d: any) => color(d.data.key))
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .on('click', (event: any, d: any) => {
         this.dataService.setFilter('lvefGroup', d.data.key);
      })
      .append('title')
      .text((d: any) => `${d.data.key}: ${d.data.value} คน`);
      
    svg.append("text")
       .attr("text-anchor", "middle")
       .attr("dy", "0.3em")
       .text("LVEF")
       .attr("font-weight", "bold")
       .attr("font-size", "12px")
       .attr("fill", "#374151");
  }

  renderInsuranceChart() {
    const container = d3.select('#insurance-pie-chart');
    if (container.empty()) return;
    container.selectAll('*').remove(); 

    const width = 200, height = 180, radius = Math.min(width, height) / 2;
    const svg = container.append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width/2},${height/2})`);

    const patients = this.dataService.patients();
    const counts: any = {};
    patients.forEach(p => {
      const k = p.insurance || 'Other';
      counts[k] = (counts[k] || 0) + 1;
    });
    
    const data = Object.entries(counts).map(([key, value]) => ({ key, value }));
    const color = d3.scaleOrdinal(d3.schemeSet2);

    const pie = d3.pie().value((d: any) => d.value);
    const arc = d3.arc().innerRadius(0).outerRadius(radius - 5);

    svg.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d: any) => color(d.data.key))
      .attr('stroke', 'white')
      .style('stroke-width', '1px')
      .style('cursor', 'pointer')
      .on('click', (event: any, d: any) => {
         this.dataService.setFilter('insurance', d.data.key);
      })
      .append('title')
      .text((d: any) => `${d.data.key}: ${d.data.value} คน`);
  }

  renderAgeChart() {
    const container = d3.select('#age-bar-chart');
    if (container.empty()) return;
    container.selectAll('*').remove();

    const width = 200, height = 180, radius = Math.min(width, height) / 2;
    const svg = container.append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width/2},${height/2})`);

    const patients = this.dataService.patients();
    const bins = { '<40': 0, '41-60': 0, '61-80': 0, '>80': 0 };
    patients.forEach(p => {
      if(p.age <= 40) bins['<40']++;
      else if(p.age <= 60) bins['41-60']++;
      else if(p.age <= 80) bins['61-80']++;
      else bins['>80']++;
    });

    const data = Object.entries(bins).map(([key, value]) => ({ key, value }));
    const color = d3.scaleOrdinal().range(['#818cf8', '#6366f1', '#4f46e5', '#3730a3']);

    const pie = d3.pie().value((d: any) => d.value);
    const arc = d3.arc().innerRadius(0).outerRadius(radius - 5);

    svg.selectAll('path')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d: any) => color(d.data.key))
      .attr('stroke', 'white')
      .style('stroke-width', '1px')
      .style('cursor', 'pointer')
      .on('click', (event: any, d: any) => {
         this.dataService.setFilter('ageGroup', d.data.key);
      })
      .append('title')
      .text((d: any) => `${d.data.key}: ${d.data.value} คน`);
  }

  renderLocationChart() {
    const container = d3.select('#district-bar-chart');
    if (container.empty()) return;
    const node = container.node();
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0) return; 

    container.selectAll('*').remove();
    
    const currentLevel = this.locationLevel();
    const filtered = this.dataService.filteredPatients(); 
    
    const counts: {[key:string]: number} = {};
    
    if (currentLevel === 'province') {
        filtered.forEach(p => {
           const prov = p.address.province || 'ไม่ระบุ';
           counts[prov] = (counts[prov] || 0) + 1;
        });
    } else if (currentLevel === 'district') {
        filtered.forEach(p => {
           const dist = p.address.district || 'ไม่ระบุ';
           counts[dist] = (counts[dist] || 0) + 1;
        });
    } else {
        filtered.forEach(p => {
           const sub = p.address.subDistrict || 'ไม่ระบุ';
           counts[sub] = (counts[sub] || 0) + 1;
        });
    }

    const data = Object.entries(counts).map(([key, value]) => ({ key, value }));
    
    if (data.length === 0) {
        container.append("div").text("ไม่พบข้อมูล").attr("class", "text-center text-gray-500 py-10");
        return;
    }

    data.sort((a, b) => b.value - a.value);

    const margin = {top: 20, right: 20, bottom: 40, left: 40};
    const width = rect.width - margin.left - margin.right;
    const height = 250 - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
      .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
        .range([0, width])
        .padding(0.3)
        .domain(data.map(d => d.key));
        
    const y = d3.scaleLinear()
        .range([height, 0])
        .domain([0, d3.max(data, d => d.value) as number]);

    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x))
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-25)")
        .style("font-family", "Sarabun")
        .style("font-weight", "bold");

    svg.append("g").call(d3.axisLeft(y).ticks(5));

    svg.selectAll(".bar")
        .data(data)
        .enter().append("rect")
        .attr("class", "bar")
        .attr("x", (d: any) => x(d.key))
        .attr("width", x.bandwidth())
        .attr("y", (d: any) => y(d.value))
        .attr("height", (d: any) => height - y(d.value))
        .attr("fill", "#4f46e5")
        .style("cursor", "pointer")
        .on("click", (event: any, d: any) => {
             const level = this.locationLevel();
             if (level === 'province') {
                 this.dataService.setFilter('province', d.key);
                 this.locationLevel.set('district');
                 this.locationBreadcrumb.update(b => [...b, d.key]);
             } else if (level === 'district') {
                 this.dataService.setFilter('district', d.key);
                 this.locationLevel.set('subDistrict');
                 this.locationBreadcrumb.update(b => [...b, d.key]);
             } else {
                 this.dataService.setFilter('subDistrict', d.key);
             }
        })
        .append("title")
        .text((d: any) => `${d.value} คน`);
  }
  
  renderEtiologyChart() {
    const container = d3.select('#etiology-chart');
    if (container.empty()) return;
    container.selectAll('*').remove();
    
    const width = 280, height = 250, radius = Math.min(width, height) / 2;
    const svg = container.append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width/2},${height/2})`);

    const patients = this.dataService.filteredPatients(); // Use filtered patients
    const counts: any = {};
    patients.forEach(p => {
      const k = p.etiology || 'Other';
      counts[k] = (counts[k] || 0) + 1;
    });
    const data = Object.entries(counts).map(([key, value]) => ({ key, value }));

    const color = d3.scaleOrdinal().range(['#db2777', '#7c3aed', '#0d9488']);
    const pie = d3.pie().value((d: any) => d.value);
    const arc = d3.arc().innerRadius(0).outerRadius(radius - 20);

    svg.selectAll('path')
      .data(pie(data))
      .enter().append('path')
      .attr('d', arc)
      .attr('fill', (d: any) => color(d.data.key))
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .on('click', (event: any, d: any) => {
         this.dataService.setFilter('etiology', d.data.key);
      })
      .append('title')
      .text((d: any) => `${d.data.key}: ${d.data.value} คน`);
  }
}