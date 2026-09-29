export namespace app {
	
	export class AppState {
	    status: string;
	    isPaused: boolean;
	    deviceName: string;
	    hz: number;
	    pingMs: number;
	    connectedTime: string;
	    pitch: number;
	    roll: number;
	    yaw: number;
	    ip: string;
	    gamepadUrl: string;
	    setupUrl: string;
	    qrCode: string;
	    setupQrCode: string;
	    rawRotX: number;
	    rawRotY: number;
	    rawRotZ: number;
	    rawAccX: number;
	    rawAccY: number;
	    rawAccZ: number;
	    qx: number;
	    qy: number;
	    qz: number;
	    qw: number;
	    profiles: profiles.View[];
	    activeSlot: number;
	    activeMatrix: number[][];
	    ahrsQ0: number;
	    ahrsQ1: number;
	    ahrsQ2: number;
	    ahrsQ3: number;
	    firstLaunch: boolean;
	    hideAuthor: boolean;
	    dsuClients: number;
	    dsuClientList: dsuclients.View[];
	    dsuKickedList: dsuclients.View[];
	    inputMode: string;
	    usbConnected: boolean;
	    usbPort: string;
	
	    static createFrom(source: any = {}) {
	        return new AppState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.isPaused = source["isPaused"];
	        this.deviceName = source["deviceName"];
	        this.hz = source["hz"];
	        this.pingMs = source["pingMs"];
	        this.connectedTime = source["connectedTime"];
	        this.pitch = source["pitch"];
	        this.roll = source["roll"];
	        this.yaw = source["yaw"];
	        this.ip = source["ip"];
	        this.gamepadUrl = source["gamepadUrl"];
	        this.setupUrl = source["setupUrl"];
	        this.qrCode = source["qrCode"];
	        this.setupQrCode = source["setupQrCode"];
	        this.rawRotX = source["rawRotX"];
	        this.rawRotY = source["rawRotY"];
	        this.rawRotZ = source["rawRotZ"];
	        this.rawAccX = source["rawAccX"];
	        this.rawAccY = source["rawAccY"];
	        this.rawAccZ = source["rawAccZ"];
	        this.qx = source["qx"];
	        this.qy = source["qy"];
	        this.qz = source["qz"];
	        this.qw = source["qw"];
	        this.profiles = this.convertValues(source["profiles"], profiles.View);
	        this.activeSlot = source["activeSlot"];
	        this.activeMatrix = source["activeMatrix"];
	        this.ahrsQ0 = source["ahrsQ0"];
	        this.ahrsQ1 = source["ahrsQ1"];
	        this.ahrsQ2 = source["ahrsQ2"];
	        this.ahrsQ3 = source["ahrsQ3"];
	        this.firstLaunch = source["firstLaunch"];
	        this.hideAuthor = source["hideAuthor"];
	        this.dsuClients = source["dsuClients"];
	        this.dsuClientList = this.convertValues(source["dsuClientList"], dsuclients.View);
	        this.dsuKickedList = this.convertValues(source["dsuKickedList"], dsuclients.View);
	        this.inputMode = source["inputMode"];
	        this.usbConnected = source["usbConnected"];
	        this.usbPort = source["usbPort"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AxisAlignStatus {
	    known: boolean;
	    pairs: number;
	    minPairs: number;
	    mapping: string[];
	
	    static createFrom(source: any = {}) {
	        return new AxisAlignStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.known = source["known"];
	        this.pairs = source["pairs"];
	        this.minPairs = source["minPairs"];
	        this.mapping = source["mapping"];
	    }
	}
	export class CaptureResult {
	    success: boolean;
	    axisIdx: number;
	    sign: number;
	    axisName: string;
	    confidence: number;
	    sampleCount: number;
	    peakSpeed: number;
	    vector: number[];
	    errorCode: string;
	    errorMsg: string;
	
	    static createFrom(source: any = {}) {
	        return new CaptureResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.axisIdx = source["axisIdx"];
	        this.sign = source["sign"];
	        this.axisName = source["axisName"];
	        this.confidence = source["confidence"];
	        this.sampleCount = source["sampleCount"];
	        this.peakSpeed = source["peakSpeed"];
	        this.vector = source["vector"];
	        this.errorCode = source["errorCode"];
	        this.errorMsg = source["errorMsg"];
	    }
	}
	export class CemuNotice {
	    guardOn: boolean;
	    prUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new CemuNotice(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.guardOn = source["guardOn"];
	        this.prUrl = source["prUrl"];
	    }
	}
	export class FirewallResult {
	    result: string;
	    detail?: string;
	    status: firewall.Status;
	
	    static createFrom(source: any = {}) {
	        return new FirewallResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.detail = source["detail"];
	        this.status = this.convertValues(source["status"], firewall.Status);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UpdateInfo {
	    current: string;
	    latest: string;
	    releaseUrl: string;
	    downloadUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.releaseUrl = source["releaseUrl"];
	        this.downloadUrl = source["downloadUrl"];
	    }
	}
	export class ValidationResult {
	    success: boolean;
	    errorCode: string;
	    errorMsg: string;
	    matrix: number[][];
	    det: number;
	    pitchAxis: string;
	    yawAxis: string;
	    rollAxis: string;
	
	    static createFrom(source: any = {}) {
	        return new ValidationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.errorCode = source["errorCode"];
	        this.errorMsg = source["errorMsg"];
	        this.matrix = source["matrix"];
	        this.det = source["det"];
	        this.pitchAxis = source["pitchAxis"];
	        this.yawAxis = source["yawAxis"];
	        this.rollAxis = source["rollAxis"];
	    }
	}

}

export namespace dsuclients {
	
	export class View {
	    address: string;
	    ip: string;
	    port: number;
	    lastSeenMs: number;
	    active: boolean;
	    connectedAtMs: number;
	    cemuBias: number[];
	    cemuSamples: number;
	    cemuGuard: boolean;
	    process?: string;
	    pid?: number;
	
	    static createFrom(source: any = {}) {
	        return new View(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.address = source["address"];
	        this.ip = source["ip"];
	        this.port = source["port"];
	        this.lastSeenMs = source["lastSeenMs"];
	        this.active = source["active"];
	        this.connectedAtMs = source["connectedAtMs"];
	        this.cemuBias = source["cemuBias"];
	        this.cemuSamples = source["cemuSamples"];
	        this.cemuGuard = source["cemuGuard"];
	        this.process = source["process"];
	        this.pid = source["pid"];
	    }
	}

}

export namespace firewall {
	
	export class Status {
	    state: string;
	    network: string;
	    detail?: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.network = source["network"];
	        this.detail = source["detail"];
	    }
	}

}

export namespace motion {
	
	export class MountCorrection {
	    status: string;
	    enabled: boolean;
	    r: number[][];
	    tiltDeg: number;
	    forwardDeg: number;
	    rightDeg: number;
	    checkDeg: number;
	
	    static createFrom(source: any = {}) {
	        return new MountCorrection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.enabled = source["enabled"];
	        this.r = source["r"];
	        this.tiltDeg = source["tiltDeg"];
	        this.forwardDeg = source["forwardDeg"];
	        this.rightDeg = source["rightDeg"];
	        this.checkDeg = source["checkDeg"];
	    }
	}

}

export namespace profiles {
	
	export class View {
	    slot: number;
	    name: string;
	    device: string;
	    icon: string;
	    matrix: number[][];
	    calGravity?: number[];
	    // Go type: motion
	    sensorFrame?: any;
	    mount?: motion.MountCorrection;
	    active: boolean;
	    version?: number;
	    calibratedAt?: number;
	    calibratedWith?: string;
	    outdated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new View(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slot = source["slot"];
	        this.name = source["name"];
	        this.device = source["device"];
	        this.icon = source["icon"];
	        this.matrix = source["matrix"];
	        this.calGravity = source["calGravity"];
	        this.sensorFrame = this.convertValues(source["sensorFrame"], null);
	        this.mount = this.convertValues(source["mount"], motion.MountCorrection);
	        this.active = source["active"];
	        this.version = source["version"];
	        this.calibratedAt = source["calibratedAt"];
	        this.calibratedWith = source["calibratedWith"];
	        this.outdated = source["outdated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace settings {
	
	export class Settings {
	    theme: string;
	    lang: string;
	    fontScale: number;
	    activeSlot: number;
	    firstLaunchDone: boolean;
	    hideAuthor: boolean;
	    dsuPort: number;
	    dsuMac: string;
	    httpPort: number;
	    httpsPort: number;
	    gyroDeadzone: number;
	    stillnessHint: boolean;
	    disconnectAlert: boolean;
	    silenceDisconnect: boolean;
	    cemuDriftGuard: boolean;
	    cemuNoticeHidden?: boolean;
	    checkUpdates: boolean;
	    skippedUpdate?: string;
	    soundMode: string;
	    soundVolume: number;
	    soundVolumes?: Record<string, number>;
	    gyroDeadband: number;
	    gyroDeadbandUsb: number;
	    gyroSensitivity: number;
	    minimizeToTray: boolean;
	    closeAction: string;
	    hotkeyRecenterEnabled: boolean;
	    hotkeyRecenterKey: string;
	    inputMode?: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.lang = source["lang"];
	        this.fontScale = source["fontScale"];
	        this.activeSlot = source["activeSlot"];
	        this.firstLaunchDone = source["firstLaunchDone"];
	        this.hideAuthor = source["hideAuthor"];
	        this.dsuPort = source["dsuPort"];
	        this.dsuMac = source["dsuMac"];
	        this.httpPort = source["httpPort"];
	        this.httpsPort = source["httpsPort"];
	        this.gyroDeadzone = source["gyroDeadzone"];
	        this.stillnessHint = source["stillnessHint"];
	        this.disconnectAlert = source["disconnectAlert"];
	        this.silenceDisconnect = source["silenceDisconnect"];
	        this.cemuDriftGuard = source["cemuDriftGuard"];
	        this.cemuNoticeHidden = source["cemuNoticeHidden"];
	        this.checkUpdates = source["checkUpdates"];
	        this.skippedUpdate = source["skippedUpdate"];
	        this.soundMode = source["soundMode"];
	        this.soundVolume = source["soundVolume"];
	        this.soundVolumes = source["soundVolumes"];
	        this.gyroDeadband = source["gyroDeadband"];
	        this.gyroDeadbandUsb = source["gyroDeadbandUsb"];
	        this.gyroSensitivity = source["gyroSensitivity"];
	        this.minimizeToTray = source["minimizeToTray"];
	        this.closeAction = source["closeAction"];
	        this.hotkeyRecenterEnabled = source["hotkeyRecenterEnabled"];
	        this.hotkeyRecenterKey = source["hotkeyRecenterKey"];
	        this.inputMode = source["inputMode"];
	    }
	}

}

export namespace version {
	
	export class Info {
	    release: string;
	    build: string;
	    channel: string;
	    display: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.release = source["release"];
	        this.build = source["build"];
	        this.channel = source["channel"];
	        this.display = source["display"];
	    }
	}

}

