using System;
using System.Reflection;
using XingShuRuntime.Core;
using Core;
using Core.Net;
using Core.Scene;
using Cysharp.Threading.Tasks;
using GameLogic;
using Tools;
using UnityEngine;
using party.protocol;
using XingShuRuntime.UI;

namespace XingShuRuntime.Utilities;

internal sealed class AutoResetActionTimeGUI : MonoBehaviour
{
	internal const string PREF_KEY_ENABLED = XingShuConfigKeys.AutoReconnectEnabled;

	private bool _enabled = true;

	private int _interceptedKickCount;

	private int _reconnectSuccessCount;

	private string _lastInterceptTimeStr = "无";

	private string _statusMsg = "";

	private float _statusMsgTimer;

	private double _nextMaintenanceRealTime;

	private double _lastReconnectRealTime;

	private static TimeOutKickPlayerS2CRPC.OnTimeOutKickPlayerS2CServerDelegate _originalKickCallback;

	private static TimeOutKickPlayerS2CRPC.OnTimeOutKickPlayerS2CServerDelegate _wrappedKickCallback;

	private static bool _hookRegistered;

	private static bool _capturedAfkCheck;

	private static bool _savedAfkCheck;

	private static TimeProtector _cachedTimeProtector;

	private static bool _capturedTimeProtectorDefaults;

	private static bool _savedTimeProtectorEnabled;

	private static float _savedTimeScaleThreshold;

	private static float _savedMaxSlowDuration;

	private static float _savedMaxSlowDurationCe;

	private bool _showUI;

	private Rect _windowRect = new Rect(120f, 120f, 550f, 310f);

	private Vector2 _scrollPos = Vector2.zero;

	private static Texture2D _whiteTex;

	public static AutoResetActionTimeGUI Instance { get; private set; }

	public static bool IsEnabled
	{
		get
		{
			if (!(Instance != null))
			{
				return XingShuConfigService.GetBool(XingShuConfigKeys.AutoReconnectEnabled, XingShuConfigKeys.AutoReconnectEnabledDefault);
			}
			return Instance._enabled;
		}
	}

	public static int InterceptedKickCount
	{
		get
		{
			if (!(Instance != null))
			{
				return 0;
			}
			return Instance._interceptedKickCount;
		}
	}

	public static int ReconnectSuccessCount
	{
		get
		{
			if (!(Instance != null))
			{
				return 0;
			}
			return Instance._reconnectSuccessCount;
		}
	}

	internal static bool UseModernView { get; set; } = true;

	internal static void SetEnabled(bool value)
	{
		if (Instance != null)
		{
			if (Instance._enabled != value)
			{
				Instance._enabled = value;
				Instance.SaveConfig();
				if (value)
				{
					EnsureRPCHook();
					EnforceAntiCheatProtectionBypass();
				}
				else
				{
					RestoreRPCHook();
					RestoreAntiCheatProtectionDefaults();
				}
			}
		}
		else
		{
			XingShuConfigService.SetBool(XingShuConfigKeys.AutoReconnectEnabled, value);
			XingShuConfigService.Save();
			if (!value)
			{
				RestoreRPCHook();
				RestoreAntiCheatProtectionDefaults();
			}
		}
	}

	internal static string LastInterceptTime => (Instance != null) ? Instance._lastInterceptTimeStr : "无";

	internal static bool IsHookRegistered => _hookRegistered;

	internal static bool IsInBattle
	{
		get
		{
			try
			{
				return SimpleSingletonProvider<SceneManager>.hasInstance &&
					SimpleSingletonProvider<SceneManager>.inst.currentType != null &&
					SimpleSingletonProvider<SceneManager>.inst.currentType.Value == SceneType.Battle;
			}
			catch
			{
				return false;
			}
		}
	}

	internal static long CurrentRoomId
	{
		get
		{
			try
			{
				if (IsInBattle)
				{
					RoomLogic room = SimpleSingletonProvider<GameLogicManager>.inst?.room;
					if (room != null && room.curRoomInfo != null)
					{
						return room.curRoomInfo.Id;
					}
				}
			}
			catch
			{
			}
			return 0L;
		}
	}

	public static void ToggleWindow()
	{
		if (UseModernView)
		{
			try
			{
				AssistBallGUI assistBall = UnityEngine.Object.FindObjectOfType<AssistBallGUI>();
				if (assistBall != null)
				{
					assistBall.SetMenuOpen(false);
				}
			}
			catch
			{
			}
			XingShuUICenter.OpenActionGuardPage();
			return;
		}
		Instance?.Toggle();
	}

	public static void OpenLegacyWindow()
	{
		if (Instance != null)
		{
			Instance._showUI = true;
		}
	}

	private static Texture2D WhiteTex
	{
		get
		{
			if (_whiteTex == null)
			{
				_whiteTex = new Texture2D(1, 1);
				_whiteTex.SetPixel(0, 0, Color.white);
				_whiteTex.Apply();
			}
			return _whiteTex;
		}
	}

	public static void Install(GameObject host)
	{
		if (!(host != null) || !(host.GetComponent<AutoResetActionTimeGUI>() == null))
		{
			return;
		}
		host.AddComponent<AutoResetActionTimeGUI>();
		Debug.Log("[XingShu Plugin] AutoResetActionTimeGUI 超时自动重连插件已挂载至宿主");
		try
		{
			AssistBall.RegisterAction("XingShu.ActionTimeGuard", "星枢超时重连", delegate
			{
				ToggleWindow();
			}, 40, "拦截服务端超时踢出、禁用变速检测自杀并自动无感重连战局", "shield", () => IsEnabled);
		}
		catch (Exception ex)
		{
			Debug.LogWarning("[XingShu Plugin] 向 AssistBall 注册超时自动重连功能异常: " + ex.Message);
		}
	}

	private void Awake()
	{
		XingShuOverlayInput.Register(this, () => _showUI && !UseModernView, () => XingShuOverlayInput.ScaledRect(_windowRect, XingShuMobileUIHelper.ScaleFactor));
		Instance = this;
		LoadConfig();
		if (_enabled)
		{
			EnsureRPCHook();
			EnforceAntiCheatProtectionBypass();
		}
	}

	private void Start()
	{
		if (_enabled)
		{
			EnsureRPCHook();
			EnforceAntiCheatProtectionBypass();
		}
	}

	private void OnDestroy()
	{
		RestoreRPCHook();
		RestoreAntiCheatProtectionDefaults();
		if (Instance == this)
		{
			Instance = null;
		}
	}

	public void LoadConfig()
	{
		try
		{
			_enabled = XingShuConfigService.GetBool(XingShuConfigKeys.AutoReconnectEnabled, XingShuConfigKeys.AutoReconnectEnabledDefault);
		}
		catch (Exception ex)
		{
			Debug.LogWarning("[XingShu 超时自动重连] 加载配置异常: " + ex.Message);
		}
	}

	public void SaveConfig()
	{
		try
		{
			XingShuConfigService.SetBool(XingShuConfigKeys.AutoReconnectEnabled, _enabled);
			XingShuConfigService.Save();
			ShowStatus("配置已保存");
		}
		catch (Exception ex)
		{
			Debug.LogWarning("[XingShu 超时自动重连] 保存配置异常: " + ex.Message);
		}
	}

	public void Toggle()
	{
		_showUI = !_showUI;
	}

	public void ShowStatus(string msg)
	{
		_statusMsg = msg;
		_statusMsgTimer = 3.5f;
	}

	private void Update()
	{
		double now = ThinkingClock.RealSeconds();
		if (_enabled)
		{
			if (now >= _nextMaintenanceRealTime)
			{
				_nextMaintenanceRealTime = now + ActionGuardPolicy.MaintenanceIntervalRealSeconds;
				EnsureRPCHook();
				EnforceAntiCheatProtectionBypass();
			}
		}
		else if (_hookRegistered)
		{
			RestoreRPCHook();
		}
		if (_statusMsgTimer > 0f)
		{
			_statusMsgTimer -= Time.unscaledDeltaTime;
			if (_statusMsgTimer <= 0f)
			{
				_statusMsg = "";
			}
		}
	}

	private static void EnsureRPCHook()
	{
		try
		{
			if (Instance != null && !Instance._enabled)
			{
				RestoreRPCHook();
				return;
			}
			NetManager inst = MonoSingletonProvider<NetManager>.inst;
			if (inst == null || inst.RPC == null || inst.RPC.TimeOutKickPlayerS2C == null)
			{
				_hookRegistered = false;
				return;
			}
			if (_wrappedKickCallback == null)
			{
				_wrappedKickCallback = InterceptedTimeOutKickCallback;
			}
			TimeOutKickPlayerS2CRPC.OnTimeOutKickPlayerS2CServerDelegate current = inst.RPC.TimeOutKickPlayerS2C.OnTimeOutKickPlayerS2CServerCallBackAsync;
			if (current == _wrappedKickCallback)
			{
				_hookRegistered = true;
				return;
			}
			if (current != null)
			{
				_originalKickCallback = current;
			}
			inst.RPC.TimeOutKickPlayerS2C.OnTimeOutKickPlayerS2CServerCallBackAsync = _wrappedKickCallback;
			_hookRegistered = true;
		}
		catch (Exception ex)
		{
			_hookRegistered = false;
			Debug.LogWarning("[XingShu 超时自动重连] 挂接 TimeOutKickPlayerS2C 异常: " + ex.Message);
		}
	}

	private static void RestoreRPCHook()
	{
		try
		{
			NetManager inst = MonoSingletonProvider<NetManager>.inst;
			if (inst != null && inst.RPC != null && inst.RPC.TimeOutKickPlayerS2C != null &&
				_wrappedKickCallback != null &&
				inst.RPC.TimeOutKickPlayerS2C.OnTimeOutKickPlayerS2CServerCallBackAsync == _wrappedKickCallback)
			{
				inst.RPC.TimeOutKickPlayerS2C.OnTimeOutKickPlayerS2CServerCallBackAsync = _originalKickCallback;
			}
			_hookRegistered = false;
		}
		catch
		{
			_hookRegistered = false;
		}
	}

	private static async UniTask InterceptedTimeOutKickCallback(TimeOutKickPlayerS2C model, int errId, bool isDispatch)
	{
		bool enabled = Instance != null && Instance._enabled;
		double now = ThinkingClock.RealSeconds();
		long currentRoomId = CurrentRoomId;
		long kickRoomId = model != null ? model.RoomId : 0L;
		bool isExit = model != null && model.IsExit;
		double lastReconnect = Instance != null ? Instance._lastReconnectRealTime : 0d;

		KickEvaluationOutcome outcome = ActionGuardPolicy.EvaluateKick(
			enabled,
			IsInBattle,
			currentRoomId,
			kickRoomId,
			isExit,
			now,
			lastReconnect);

		if (outcome == KickEvaluationOutcome.ForwardOriginal)
		{
			if (_originalKickCallback != null)
			{
				await _originalKickCallback(model, errId, isDispatch);
			}
			return;
		}

		if (Instance != null)
		{
			Instance._interceptedKickCount++;
			Instance._lastInterceptTimeStr = DateTime.Now.ToString("HH:mm:ss");
		}

		if (outcome == KickEvaluationOutcome.IgnoreMismatchRoom)
		{
			Debug.LogWarning($"[XingShu 超时自动重连] 忽略过期/非当前房间踢出包: KickRoomId={kickRoomId}, CurrentRoomId={currentRoomId}");
			return;
		}
		if (outcome == KickEvaluationOutcome.IgnoreExitSignal)
		{
			Debug.Log($"[XingShu 超时自动重连] 收到主动退出/结束标记踢出包 (RoomId={kickRoomId}, IsExit=true)，跳过强制重连");
			if (_originalKickCallback != null)
			{
				await _originalKickCallback(model, errId, isDispatch);
			}
			return;
		}
		if (outcome == KickEvaluationOutcome.CooldownBlocked)
		{
			Debug.Log("[XingShu 超时自动重连] 命中真实时钟重连防抖窗口，跳过重复重连");
			return;
		}

		if (Instance != null)
		{
			Instance._lastReconnectRealTime = now;
			Instance.ShowStatus("已拦截服务端超时踢出，正在无感恢复战局...");
		}
		Debug.LogWarning($"[XingShu 超时自动重连] 拦截到服务端超时踢出: RoomId={kickRoomId}, IsExit={isExit}。正在执行无感战局同步！");
		TriggerSeamlessReconnect(kickRoomId);
		await UniTask.CompletedTask;
	}

	public static void TriggerSeamlessReconnect(long targetRoomId = 0L)
	{
		try
		{
			NetManager inst = MonoSingletonProvider<NetManager>.inst;
			if (inst == null)
			{
				return;
			}
			inst.closeType = CloseType.None;
			long num = targetRoomId;
			if (num == 0L && SimpleSingletonProvider<GameLogicManager>.inst?.room?.curRoomInfo != null)
			{
				num = SimpleSingletonProvider<GameLogicManager>.inst.room.curRoomInfo.Id;
			}
			if (inst.IsConnected && num != 0L)
			{
				Debug.Log($"[XingShu 超时自动重连] 当前网络存活，向服务端发起房间全量无感同步 (RoomId={num})...");
				RoomLogic roomLogic = SimpleSingletonProvider<GameLogicManager>.inst?.room;
				if (roomLogic != null && roomLogic.roomController != null)
				{
					roomLogic.RequestSyncRoomC2S(num);
					if (Instance != null)
					{
						Instance._reconnectSuccessCount++;
						Instance.ShowStatus("已成功向服务端发送房间全量状态同步请求");
					}
					return;
				}
			}
			Debug.Log("[XingShu 超时自动重连] 网络已断开或需重新握手，正在调用游戏原生 ReconnectServer 无感重连流...");
			if (InvokeNativeReconnectServer(inst) && Instance != null)
			{
				Instance._reconnectSuccessCount++;
				Instance.ShowStatus("正在调用游戏原生重连流恢复战局...");
			}
		}
		catch (Exception ex)
		{
			Debug.LogWarning("[XingShu 超时自动重连] 执行无感重连异常: " + ex.Message);
		}
	}

	private static bool InvokeNativeReconnectServer(NetManager net)
	{
		try
		{
			net.closeType = CloseType.None;
			FieldInfo field = typeof(NetManager).GetField("_preReconnectingTime", BindingFlags.Instance | BindingFlags.NonPublic);
			if (field != null)
			{
				field.SetValue(net, 0f);
			}
			FieldInfo field2 = typeof(NetManager).GetField("_Reconnecting", BindingFlags.Instance | BindingFlags.NonPublic);
			if (field2 != null)
			{
				field2.SetValue(net, false);
			}
			MethodInfo method = typeof(NetManager).GetMethod("ReconnectServer", BindingFlags.Instance | BindingFlags.NonPublic);
			if (method != null)
			{
				method.Invoke(net, null);
				return true;
			}
			net.Reconnect();
			return true;
		}
		catch (Exception ex)
		{
			Debug.LogWarning("[XingShu 超时自动重连] InvokeNativeReconnectServer 反射调用异常: " + ex.Message);
			return false;
		}
	}

	private static TimeProtector FindOrCachedTimeProtector()
	{
		if (_cachedTimeProtector == null)
		{
			_cachedTimeProtector = UnityEngine.Object.FindObjectOfType<TimeProtector>();
		}
		return _cachedTimeProtector;
	}

	public static void EnforceAntiCheatProtectionBypass()
	{
		try
		{
			if (Instance != null && !Instance._enabled)
			{
				return;
			}
			if (!_capturedAfkCheck)
			{
				_savedAfkCheck = GMConfig.AFKCheck;
				_capturedAfkCheck = true;
			}
			GMConfig.AFKCheck = false;
			FieldInfo field = typeof(OperationTimer).GetField("_AFK", BindingFlags.Static | BindingFlags.NonPublic);
			if (field != null)
			{
				field.SetValue(null, false);
			}
			FieldInfo field2 = typeof(OperationTimer).GetField("_AFKTime", BindingFlags.Static | BindingFlags.NonPublic);
			if (field2 != null)
			{
				field2.SetValue(null, 0);
			}
			TimeProtector timeProtector = FindOrCachedTimeProtector();
			if (timeProtector != null)
			{
				FieldInfo field3 = typeof(TimeProtector).GetField("timeScaleThreshold", BindingFlags.Instance | BindingFlags.NonPublic);
				FieldInfo field4 = typeof(TimeProtector).GetField("maxSlowDuration", BindingFlags.Instance | BindingFlags.NonPublic);
				FieldInfo field5 = typeof(TimeProtector).GetField("maxSlowDuration_CE", BindingFlags.Instance | BindingFlags.NonPublic);
				FieldInfo field6 = typeof(TimeProtector).GetField("slowStartTime", BindingFlags.Instance | BindingFlags.NonPublic);
				if (!_capturedTimeProtectorDefaults)
				{
					_savedTimeProtectorEnabled = timeProtector.enabled;
					if (field3 != null) _savedTimeScaleThreshold = Convert.ToSingle(field3.GetValue(timeProtector));
					if (field4 != null) _savedMaxSlowDuration = Convert.ToSingle(field4.GetValue(timeProtector));
					if (field5 != null) _savedMaxSlowDurationCe = Convert.ToSingle(field5.GetValue(timeProtector));
					_capturedTimeProtectorDefaults = true;
				}
				if (timeProtector.enabled)
				{
					timeProtector.enabled = false;
					Debug.Log("[XingShu 超时自动重连] 已成功禁用 TimeProtector 变速检测组件");
				}
				if (field3 != null) field3.SetValue(timeProtector, 0f);
				if (field4 != null) field4.SetValue(timeProtector, float.MaxValue);
				if (field5 != null) field5.SetValue(timeProtector, float.MaxValue);
				if (field6 != null) field6.SetValue(timeProtector, Time.realtimeSinceStartup);
			}
		}
		catch (Exception ex)
		{
			Debug.LogWarning("[XingShu 超时自动重连] 防反作弊/挂机保护绕过处理异常: " + ex.Message);
		}
	}

	private static void RestoreAntiCheatProtectionDefaults()
	{
		try
		{
			if (_capturedAfkCheck)
			{
				GMConfig.AFKCheck = _savedAfkCheck;
			}
			TimeProtector timeProtector = FindOrCachedTimeProtector();
			if (timeProtector != null && _capturedTimeProtectorDefaults)
			{
				FieldInfo field3 = typeof(TimeProtector).GetField("timeScaleThreshold", BindingFlags.Instance | BindingFlags.NonPublic);
				FieldInfo field4 = typeof(TimeProtector).GetField("maxSlowDuration", BindingFlags.Instance | BindingFlags.NonPublic);
				FieldInfo field5 = typeof(TimeProtector).GetField("maxSlowDuration_CE", BindingFlags.Instance | BindingFlags.NonPublic);
				if (field3 != null) field3.SetValue(timeProtector, _savedTimeScaleThreshold);
				if (field4 != null) field4.SetValue(timeProtector, _savedMaxSlowDuration);
				if (field5 != null) field5.SetValue(timeProtector, _savedMaxSlowDurationCe);
				timeProtector.enabled = _savedTimeProtectorEnabled;
			}
		}
		catch
		{
		}
	}

	private void OnGUI()
	{
		if (!_showUI || UseModernView)
		{
			return;
		}
		using (new XingShuMobileUIHelper.MatrixScope(0f))
		{
			GUI.skin = null;
			Color color = GUI.color;
			Color backgroundColor = GUI.backgroundColor;
			_windowRect = GUI.Window(987656, _windowRect, DrawWindow, "");
			float num = (XingShuMobileUIHelper.IsMobile ? ((float)Screen.width / XingShuMobileUIHelper.ScaleFactor) : ((float)Screen.width));
			float num2 = (XingShuMobileUIHelper.IsMobile ? ((float)Screen.height / XingShuMobileUIHelper.ScaleFactor) : ((float)Screen.height));
			_windowRect.x = Mathf.Clamp(_windowRect.x, 10f, num - _windowRect.width - 10f);
			_windowRect.y = Mathf.Clamp(_windowRect.y, 10f, num2 - _windowRect.height - 10f);
			GUI.color = color;
			GUI.backgroundColor = backgroundColor;
		}
	}

	private void DrawWindow(int windowID)
	{
		Rect rect = new Rect(0f, 0f, _windowRect.width, _windowRect.height);
		DrawRect(rect, new Color(0.09f, 0.1f, 0.13f, 0.96f));
		DrawRectBorder(rect, new Color(1f, 1f, 1f, 0.1f));
		DrawRect(new Rect(0f, 0f, rect.width, 38f), new Color(0.07f, 0.08f, 0.1f, 0.98f));
		DrawLine(new Vector2(0f, 38f), new Vector2(rect.width, 38f), new Color(1f, 1f, 1f, 0.08f));
		GUIStyle style = new GUIStyle(GUI.skin.label)
		{
			fontSize = 13,
			fontStyle = FontStyle.Bold,
			alignment = TextAnchor.MiddleLeft,
			normal = 
			{
				textColor = new Color(0.92f, 0.94f, 0.98f)
			}
		};
		GUI.Label(new Rect(16f, 8f, 260f, 22f), "超时自动重连", style);
		Rect position = new Rect(rect.width - 32f, 8f, 22f, 22f);
		GUIStyle style2 = new GUIStyle(GUI.skin.button)
		{
			fontSize = 13,
			fontStyle = FontStyle.Bold,
			alignment = TextAnchor.MiddleCenter,
			padding = new RectOffset(0, 0, 0, 0),
			contentOffset = Vector2.zero,
			normal = 
			{
				textColor = new Color(0.7f, 0.75f, 0.85f)
			}
		};
		if (GUI.Button(position, "✕", style2))
		{
			_showUI = false;
		}
		GUILayout.BeginArea(new Rect(16f, 46f, rect.width - 32f, rect.height - 54f));
		_scrollPos = GUILayout.BeginScrollView(_scrollPos, GUILayout.Width(rect.width - 32f), GUILayout.Height(rect.height - 54f));
		GUILayout.BeginHorizontal();
		bool flag = GUILayout.Toggle(_enabled, " 启用超时自动重连 (防踢出/防退回登录/战局自动拉回)", GUILayout.Height(24f));
		if (flag != _enabled)
		{
			_enabled = flag;
			SaveConfig();
			if (_enabled)
			{
				EnsureRPCHook();
				EnforceAntiCheatProtectionBypass();
			}
			else
			{
				RestoreRPCHook();
				RestoreAntiCheatProtectionDefaults();
			}
		}
		GUILayout.EndHorizontal();
		GUILayout.Space(8f);
		DrawCardHeader("核心防御与战局状态");
		GUILayout.BeginVertical(GUI.skin.box);
		DrawStatusRow("服务端超时踢出协议拦截", _hookRegistered ? "<color=#4ade80>[已接管生效]</color>" : "<color=#f87171>[未生效]</color>");
		DrawStatusRow("累计成功拦截踢出次数", $"{_interceptedKickCount} 次 (最近: {_lastInterceptTimeStr})");
		bool flag2 = true;
		TimeProtector timeProtector = UnityEngine.Object.FindObjectOfType<TimeProtector>();
		if (timeProtector != null && timeProtector.enabled)
		{
			flag2 = false;
		}
		DrawStatusRow("反作弊变速检测 (TimeProtector)", flag2 ? "<color=#4ade80>[已永久禁用 (允许长考与暂停)]</color>" : "<color=#fbbf24>[运行中]</color>");
		DrawStatusRow("客户端挂机认输检测 (AFKCheck)", (!GMConfig.AFKCheck) ? "<color=#4ade80>[已关闭 (杜绝自动认输)]</color>" : "<color=#fbbf24>[开启中]</color>");
		bool flag3 = SimpleSingletonProvider<SceneManager>.hasInstance && SimpleSingletonProvider<SceneManager>.inst.currentType != null && SimpleSingletonProvider<SceneManager>.inst.currentType.Value == SceneType.Battle;
		RoomLogic roomLogic = SimpleSingletonProvider<GameLogicManager>.inst?.room;
		string text = ((flag3 && roomLogic != null && roomLogic.curRoomInfo != null) ? $"战斗中 (ID: {roomLogic.curRoomInfo.Id})" : (flag3 ? "战斗准备中" : "非战斗场景"));
		DrawStatusRow("当前战局运行状态", flag3 ? ("<color=#38bdf8>" + text + "</color>") : "<color=#94a3b8>大厅 / 主菜单</color>");
		DrawStatusRow("累计无感重连与同步次数", $"{_reconnectSuccessCount} 次");
		GUILayout.EndVertical();
		if (!string.IsNullOrEmpty(_statusMsg))
		{
			GUILayout.Space(6f);
			GUIStyle style3 = new GUIStyle(GUI.skin.label)
			{
				fontSize = 12,
				normal = 
				{
					textColor = new Color(0.3f, 0.85f, 0.5f)
				},
				alignment = TextAnchor.MiddleCenter
			};
			GUILayout.Label(_statusMsg, style3);
		}
		GUILayout.EndScrollView();
		GUILayout.EndArea();
		GUI.DragWindow(new Rect(0f, 0f, rect.width - 36f, 38f));
	}

	private void DrawCardHeader(string title)
	{
		GUIStyle style = new GUIStyle(GUI.skin.label)
		{
			fontSize = 11,
			fontStyle = FontStyle.Bold,
			normal = 
			{
				textColor = new Color(0.6f, 0.65f, 0.75f)
			}
		};
		GUILayout.Label(title, style);
	}

	private void DrawStatusRow(string label, string value)
	{
		GUILayout.BeginHorizontal();
		GUIStyle style = new GUIStyle(GUI.skin.label)
		{
			fontSize = 12,
			normal = 
			{
				textColor = new Color(0.75f, 0.8f, 0.88f)
			}
		};
		GUIStyle style2 = new GUIStyle(GUI.skin.label)
		{
			fontSize = 12,
			richText = true,
			alignment = TextAnchor.MiddleRight,
			normal = 
			{
				textColor = Color.white
			}
		};
		GUILayout.Label(label, style, GUILayout.Width(230f));
		GUILayout.FlexibleSpace();
		GUILayout.Label(value, style2);
		GUILayout.EndHorizontal();
	}

	private static void DrawRect(Rect rect, Color color)
	{
		Color color2 = GUI.color;
		GUI.color = color;
		GUI.DrawTexture(rect, WhiteTex);
		GUI.color = color2;
	}

	private static void DrawRectBorder(Rect rect, Color color, int width = 1)
	{
		DrawRect(new Rect(rect.x, rect.y, rect.width, width), color);
		DrawRect(new Rect(rect.x, rect.y + rect.height - (float)width, rect.width, width), color);
		DrawRect(new Rect(rect.x, rect.y, width, rect.height), color);
		DrawRect(new Rect(rect.x + rect.width - (float)width, rect.y, width, rect.height), color);
	}

	private static void DrawLine(Vector2 start, Vector2 end, Color color, float width = 1f)
	{
		Color color2 = GUI.color;
		GUI.color = color;
		Vector2 vector = end - start;
		float num = 57.29578f * Mathf.Atan2(vector.y, vector.x);
		GUIUtility.RotateAroundPivot(num, start);
		GUI.DrawTexture(new Rect(start.x, start.y, vector.magnitude, width), WhiteTex);
		GUIUtility.RotateAroundPivot(0f - num, start);
		GUI.color = color2;
	}
}
